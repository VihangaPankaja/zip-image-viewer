import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { path7za } from "7zip-bin";
import { expect, test, vi } from "vite-plus/test";
import type { Session, SessionJob } from "../../../../../server/domain/models.js";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { createProcessSessionJob } from "../../../../../server/application/jobs/processSessionJob.js";
import { createSessionJobQueue } from "../../../../../server/application/jobs/sessionJobQueue.js";
import { createRetainedTorrentStore } from "../../../../../server/repositories/retainedTorrents.js";
import { restoreHttpDownloads } from "../../../../../server/application/downloads/restoreHttpDownloads.js";
import {
  detectArchiveEncryption,
  runCommandCapture,
} from "../../../../../server/infrastructure/process/commandRunner.js";
import { extractRuntimeArchive } from "../../../../../server/runtimeAdapters.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";

test.each(["zip", "7z"])(
  "retries retained encrypted HTTP %s without a network transfer and asks again after restart",
  async (type) => {
    const root = await mkdtemp(path.join(tmpdir(), "password-job-"));
    const store = createRetainedTorrentStore(root);
    const logs = vi.fn();
    const jobs = new Map<string, SessionJob>();
    const sessions = new Map<string, Session>();
    const manager = createJobManager(jobs, logs, store);
    const job = manager.createJob(`https://example.com/private.${type}`);
    const password = "fixture-private-$()";
    try {
      await mkdir(job.workspaceDir, { recursive: true });
      await writeFile(path.join(job.workspaceDir, "note.txt"), "encrypted contents");
      job.zipPath = path.join(job.workspaceDir, `source.${type}`);
      job.extractDir = path.join(job.workspaceDir, "extracted");
      await runCommandCapture(
        path7za,
        ["a", `-t${type}`, "-p", ...(type === "7z" ? ["-mhe=on"] : []), job.zipPath, "note.txt"],
        { cwd: job.workspaceDir, stdin: `${password}\n${password}\n` },
      );
      const payload = await readFile(job.zipPath);
      const hash = createHash("sha256").update(payload).digest("hex");
      job.httpDownload = {
        originalUrl: job.url,
        resolvedUrl: job.url,
        size: payload.length,
        validator: '"v1"',
        completedSha256: hash,
        files: [
          { index: -1, start: 0, end: payload.length - 1, bytes: payload.length, sha256: hash },
        ],
      };
      const download = vi.fn();
      const process = createProcessSessionJob({
        emitJob: manager.emitJob,
        closeJob: manager.closeJob,
        logEvent: logs,
        sessionStore: sessions,
        download,
        detectEncryption: (file, signal) => detectArchiveEncryption(path7za, file, signal),
        extractWith7zip: extractRuntimeArchive.bind(null, path7za),
        listExtractedEntries,
        torrentAdapter: { download: vi.fn(), close: vi.fn() },
      });
      await process(job);
      if (type === "zip") {
        const { getArchiveManifest } =
          await import("../../../../../server/application/jobs/archiveSelection.js");
        const manifest = await getArchiveManifest(job);
        job.zipSelection = {
          fingerprint: manifest.fingerprint,
          selectedIds: manifest.entries.map((entry) => entry.id),
          extractedIds: [],
        };
        await process(job);
      }
      expect(job.status).toBe("awaiting_password");
      let active = 0;
      const queue = createSessionJobQueue({
        pendingSessionJobs: [],
        initialJobs: [job],
        emitJob: manager.emitJob,
        getActiveSessionJobCount: () => active,
        incrementActiveSessionJobCount: () => active++,
        decrementActiveSessionJobCount: () => active--,
        maxActiveSessionJobs: 1,
        processSessionJob: process,
        logEvent: logs,
      });
      queue.submitArchivePassword(job.id, "wrong");
      await vi.waitFor(() => expect(job.status).toBe("awaiting_password"));
      expect(job.message).toMatch(/rejected/i);
      queue.submitArchivePassword(job.id, password);
      await vi.waitFor(() => expect(job.status).toBe("ready"));
      expect(await readFile(path.join(job.extractDir, "note.txt"), "utf8")).toBe(
        "encrypted contents",
      );
      expect(download).not.toHaveBeenCalled();
      expect(JSON.stringify(manager.sanitizeJob(job))).not.toContain(password);
      expect(JSON.stringify(store.readHttp())).not.toContain(password);
      expect(JSON.stringify(logs.mock.calls)).not.toContain(password);
      jobs.clear();
      sessions.clear();
      await restoreHttpDownloads(store, jobs, process, vi.fn());
      expect(jobs.get(job.id)?.status).toBe("awaiting_password");
      expect(sessions.size).toBe(0);
      expect(await readdir(job.workspaceDir)).not.toContain("extracted.staging");
      await queue.stopSessionJobs();
    } finally {
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
