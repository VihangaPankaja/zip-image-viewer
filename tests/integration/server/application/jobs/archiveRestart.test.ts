import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vite-plus/test";
import type { Session, SessionJob } from "../../../../../server/domain/models.js";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { createRetainedTorrentStore } from "../../../../../server/repositories/retainedTorrents.js";
import { restoreHttpDownloads } from "../../../../../server/application/downloads/restoreHttpDownloads.js";
import { restoreRetainedTorrents } from "../../../../../server/application/torrents/restoreRetainedTorrents.js";
import { prepareTorrentEntries } from "../../../../../server/application/torrents/prepareTorrentEntries.js";
import { ArchiveSelectionRequired } from "../../../../../server/application/jobs/archiveSelection.js";
import { restorePublishedArchiveSession } from "../../../../../server/application/jobs/restorePublishedArchiveSession.js";
import { extractSessionSource } from "../../../../../server/application/jobs/extractSessionSource.js";
import { inspectZip } from "../../../../../server/infrastructure/archive/zipManifest.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";
import { zipBytes } from "../../../../fixtures/zipBytes.js";
import type { TorrentAdapter } from "../../../../../server/application/torrents/torrentDownloader.js";

it.each(["cancelled", "error"] as const)(
  "restores the published HTTP ZIP library independently of a %s Extract more request",
  async (status) => {
    const directory = await mkdtemp(path.join(tmpdir(), "zip-published-"));
    const store = createRetainedTorrentStore(directory);
    try {
      const jobs = new Map<string, SessionJob>();
      const sessions = new Map<string, Session>();
      const manager = createJobManager(jobs, vi.fn(), store);
      const job = manager.createJob("https://example.com/library.zip");
      job.zipPath = path.join(job.workspaceDir, "source.zip");
      job.extractDir = path.join(job.workspaceDir, "extracted");
      await mkdir(job.extractDir, { recursive: true });
      const payload = zipBytes([
        { name: "one.txt", data: Buffer.from("published") },
        { name: "two.txt", data: Buffer.from("pending") },
      ]);
      await writeFile(job.zipPath, payload);
      const manifest = await inspectZip(job.zipPath);
      const [first, next] = manifest.entries;
      job.zipSelection = {
        fingerprint: manifest.fingerprint,
        selectedIds: [first.id],
        extractedIds: [first.id],
      };
      await extractSessionSource(job, job.zipPath, job.extractDir, {
        emitJob: manager.emitJob,
        detectEncryption: () => Promise.resolve(false),
        extractWith7zip: vi.fn(),
        listExtractedEntries,
      });
      const hash = createHash("sha256").update(payload).digest("hex");
      job.zipSelection.selectedIds.push(next.id);
      manager.emitJob(job, {
        status,
        phase: status,
        sessionId: randomUUID(),
        archive: { ...manifest, extractedCount: 1 },
        httpDownload: {
          originalUrl: job.url,
          resolvedUrl: job.url,
          size: payload.length,
          validator: '"v1"',
          files: [
            { index: -1, start: 0, end: payload.length - 1, bytes: payload.length, sha256: hash },
          ],
          completedSha256: hash,
        },
      });
      jobs.clear();
      const process = vi.fn();
      await restoreHttpDownloads(store, jobs, process, (restored) =>
        restorePublishedArchiveSession(restored, { sessionStore: sessions, listExtractedEntries }),
      );
      expect(process).not.toHaveBeenCalled();
      expect(jobs.get(job.id)).toMatchObject({
        status,
        sessionId: job.sessionId,
        zipSelection: { selectedIds: [first.id, next.id], extractedIds: [first.id] },
      });
      expect(sessions.get(job.sessionId)?.firstFilePath).toBe("one.txt");
      expect(sessions.get(job.sessionId)?.stats.fileCount).toBe(1);
      expect(await readFile(path.join(job.extractDir, "one.txt"), "utf8")).toBe("published");
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("keeps a pending torrent ZIP review retryable when session restoration requests selection", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "zip-torrent-restore-"));
  const store = createRetainedTorrentStore(directory);
  try {
    const jobs = new Map<string, SessionJob>();
    const manager = createJobManager(jobs, vi.fn(), store);
    const job = manager.createJob(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
    job.torrentMetadata = new Uint8Array([1]);
    manager.emitJob(job, {
      status: "awaiting_selection",
      phase: "selecting",
      sessionId: randomUUID(),
      torrentFiles: [
        { id: "0", path: "notes.txt", size: 1, selected: true, complete: true, downloadedBytes: 1 },
      ],
    });
    jobs.clear();
    const restore = vi.fn(() =>
      Promise.reject(new ArchiveSelectionRequired("Choose ZIP contents")),
    );
    const download = vi.fn<TorrentAdapter["download"]>(({ onMetadata }) =>
      Promise.resolve().then(() => {
        onMetadata({ name: "fixture", length: 1, files: job.torrentFiles });
        return { files: ["notes.txt"] };
      }),
    );
    await restoreRetainedTorrents(store, jobs, { download, close: vi.fn() }, restore);
    expect(restore).toHaveBeenCalledOnce();
    expect(jobs.get(job.id)?.status).toBe("awaiting_selection");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([
  { status: "cancelled", published: "one.txt", folder: "Torrent files" },
  { status: "error", published: "one.txt", folder: "Torrent files" },
  { status: "cancelled", published: "Torrent files/one.txt", folder: "Torrent files-" },
  { status: "error", published: "Torrent files/one.txt", folder: "Torrent files-" },
] as const)(
  "restores torrent ZIP siblings after $status Extract more ($folder)",
  async ({ status, published, folder }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "zip-torrent-siblings-"));
    const store = createRetainedTorrentStore(directory);
    try {
      const jobs = new Map<string, SessionJob>();
      const sessions = new Map<string, Session>();
      const manager = createJobManager(jobs, vi.fn(), store);
      const job = manager.createJob(`magnet:?xt=urn:btih:${"b".repeat(40)}`);
      const torrent = path.join(job.workspaceDir, "torrent");
      job.extractDir = path.join(job.workspaceDir, "extracted");
      job.torrentMetadata = new Uint8Array([1]);
      await mkdir(path.join(torrent, "extras"), { recursive: true });
      const payload = zipBytes([
        { name: published, data: Buffer.from("published ZIP file") },
        { name: "next.txt", data: Buffer.from("pending") },
      ]);
      await writeFile(path.join(torrent, "library.zip"), payload);
      await writeFile(path.join(torrent, "extras/notes.txt"), "published sibling");
      await writeFile(path.join(torrent, "hidden.txt"), "unselected");
      job.torrentFiles = [
        {
          id: "0",
          path: "library.zip",
          size: payload.length,
          selected: true,
          complete: true,
          downloadedBytes: payload.length,
        },
        {
          id: "1",
          path: "extras/notes.txt",
          size: 17,
          selected: true,
          complete: true,
          downloadedBytes: 17,
        },
        {
          id: "2",
          path: "hidden.txt",
          size: 10,
          selected: false,
          complete: true,
          downloadedBytes: 10,
        },
      ];
      const manifest = await inspectZip(path.join(torrent, "library.zip"));
      const [first, next] = manifest.entries;
      job.zipSelection = {
        fingerprint: manifest.fingerprint,
        selectedIds: [first.id],
        extractedIds: [],
      };
      const result = await prepareTorrentEntries(job, torrent, job.extractDir, {
        emitJob: manager.emitJob,
        detectEncryption: () => Promise.resolve(false),
        extractWith7zip: vi.fn(),
        listExtractedEntries,
        logEvent: vi.fn(),
      });
      const expected = [published, `${folder}/extras/notes.txt`].sort();
      expect(
        result.entries
          .filter((entry) => entry.type === "file")
          .map((entry) => entry.relativePath)
          .sort(),
      ).toEqual(expected);
      job.zipSelection.extractedIds = [first.id];
      job.zipSelection.selectedIds.push(next.id);
      manager.emitJob(job, { status, phase: status, sessionId: randomUUID() });
      jobs.clear();
      const download = vi.fn<TorrentAdapter["download"]>(({ onMetadata }) =>
        Promise.resolve().then(() => {
          onMetadata({ name: "fixture", length: payload.length + 27, files: job.torrentFiles });
          return { files: job.torrentFiles.map((file) => file.path) };
        }),
      );
      const list = vi.fn(listExtractedEntries);
      await restoreRetainedTorrents(store, jobs, { download, close: vi.fn() }, (restored) =>
        restorePublishedArchiveSession(restored, {
          sessionStore: sessions,
          listExtractedEntries: list,
        }),
      );
      expect(jobs.get(job.id)?.status).toBe(status);
      const session = sessions.get(job.sessionId);
      if (!session) throw new Error("Published torrent session was not restored");
      expect(session.stats.fileCount).toBe(2);
      expect(
        await readFile(path.join(session.extractDir, folder, "extras/notes.txt"), "utf8"),
      ).toBe("published sibling");
      expect(list).toHaveBeenCalledWith(job.extractDir);
      expect(JSON.stringify(session.tree)).toContain("notes.txt");
      expect(JSON.stringify(session.tree)).not.toContain("hidden.txt");
      expect(JSON.stringify(session.tree)).not.toContain("next.txt");
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
