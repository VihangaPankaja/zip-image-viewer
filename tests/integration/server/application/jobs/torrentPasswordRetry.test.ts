import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { path7za } from "7zip-bin";
import WebTorrent, { type Torrent } from "webtorrent";
import { expect, test, vi } from "vite-plus/test";
import type { Session, SessionJob } from "../../../../../server/domain/models.js";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { createProcessSessionJob } from "../../../../../server/application/jobs/processSessionJob.js";
import { createSessionJobQueue } from "../../../../../server/application/jobs/sessionJobQueue.js";
import { createRetainedTorrentStore } from "../../../../../server/repositories/retainedTorrents.js";
import { restoreRetainedTorrents } from "../../../../../server/application/torrents/restoreRetainedTorrents.js";
import { createWebTorrentAdapter } from "../../../../../server/application/torrents/torrentDownloader.js";
import {
  detectArchiveEncryption,
  runCommandCapture,
} from "../../../../../server/infrastructure/process/commandRunner.js";
import { extractRuntimeArchive } from "../../../../../server/runtimeAdapters.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";

test.each(["zip", "7z"])(
  "retries encrypted %s from real torrent pieces without requesting them again",
  async (type) => {
    const root = await mkdtemp(path.join(tmpdir(), "torrent-password-"));
    const store = createRetainedTorrentStore(root);
    const seed = new WebTorrent({
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
      natUpnp: false,
      natPmp: false,
    });
    const adapter = createWebTorrentAdapter();
    const jobs = new Map<string, SessionJob>();
    const sessions = new Map<string, Session>();
    const manager = createJobManager(jobs, vi.fn(), store);
    const password = "torrent-fixture-secret";
    try {
      const input = path.join(root, "input");
      await mkdir(input);
      await writeFile(path.join(input, "note.txt"), "torrent private contents");
      const archive = path.join(root, `private.${type}`);
      await runCommandCapture(
        path7za,
        ["a", `-t${type}`, "-p", ...(type === "7z" ? ["-mhe=on"] : []), archive, "note.txt"],
        { cwd: input, stdin: `${password}\n${password}\n` },
      );
      const torrent = await new Promise<Torrent>((resolve) =>
        seed.seed(archive, { announce: [] }, resolve),
      );
      let pieces = 0;
      torrent.on("wire", (wire) => wire.on("request", () => pieces++));
      const address = seed.address();
      if (!address || typeof address === "string") throw new Error("Missing peer port");
      const job = manager.createJob(torrent.magnetURI);
      job.torrentMetadata = torrent.torrentFile;
      const torrentDir = path.join(job.workspaceDir, "torrent");
      await adapter.download({
        source: torrent.torrentFile,
        peerHints: [`127.0.0.1:${address.port}`],
        downloadDir: torrentDir,
        signal: AbortSignal.timeout(20_000),
        retainStoreOnAbort: () => true,
        onNoPeers: () => {},
        onMetadata: ({ files }) => {
          job.torrentFiles = files.map((file) => ({ ...file, selected: true }));
          return files.map((file) => file.id);
        },
        onProgress: () => {},
      });
      expect(await readFile(path.join(torrentDir, `private.${type}`))).toEqual(
        await readFile(archive),
      );
      expect(pieces).toBeGreaterThan(0);
      job.torrentFiles = job.torrentFiles.map((file) => ({
        ...file,
        complete: true,
        downloadedBytes: file.size,
      }));
      job.torrentArchivePath = `private.${type}`;
      // The archive bytes above came from a real swarm. Password retries must use those bytes directly.
      const download = vi.fn(adapter.download);
      const process = createProcessSessionJob({
        emitJob: manager.emitJob,
        closeJob: manager.closeJob,
        logEvent: vi.fn(),
        sessionStore: sessions,
        download: vi.fn(),
        detectEncryption: (file, signal) => detectArchiveEncryption(path7za, file, signal),
        extractWith7zip: extractRuntimeArchive.bind(null, path7za),
        listExtractedEntries,
        torrentAdapter: { download, close: adapter.close },
      });
      Object.assign(job, {
        status: "awaiting_password",
        phase: "password",
        passwordProtected: true,
      });
      let active = 0;
      const queue = createSessionJobQueue({
        initialJobs: [job],
        pendingSessionJobs: [],
        emitJob: manager.emitJob,
        getActiveSessionJobCount: () => active,
        incrementActiveSessionJobCount: () => active++,
        decrementActiveSessionJobCount: () => active--,
        maxActiveSessionJobs: 1,
        processSessionJob: process,
        logEvent: vi.fn(),
      });
      if (type === "zip") {
        const { prepareZipArchive, getArchiveManifest } =
          await import("../../../../../server/application/jobs/archiveSelection.js");
        await prepareZipArchive(job, path.join(torrentDir, `private.${type}`), manager.emitJob);
        const manifest = await getArchiveManifest(job);
        job.zipSelection = {
          fingerprint: manifest.fingerprint,
          selectedIds: manifest.entries
            .filter((entry) => entry.type === "file")
            .map((entry) => entry.id),
          extractedIds: [],
        };
        Object.assign(job, { status: "awaiting_password", phase: "password" });
      }
      queue.submitArchivePassword(job.id, "wrong");
      await vi.waitFor(() => expect(job.status).toBe("awaiting_password"));
      queue.submitArchivePassword(job.id, password);
      await vi.waitFor(() => expect(job.status).toBe("ready"));
      expect(await readFile(path.join(job.extractDir, "note.txt"), "utf8")).toBe(
        "torrent private contents",
      );
      expect(download).not.toHaveBeenCalled();
      const count = pieces;
      jobs.clear();
      sessions.clear();
      await restoreRetainedTorrents(store, jobs, adapter, vi.fn());
      expect(jobs.get(job.id)).toMatchObject({ status: "awaiting_password", sessionId: "" });
      expect(pieces).toBe(count);
      expect(JSON.stringify(store.read())).not.toContain(password);
      await queue.stopSessionJobs();
    } finally {
      await adapter.close();
      await new Promise<void>((resolve) => seed.destroy(() => resolve()));
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
