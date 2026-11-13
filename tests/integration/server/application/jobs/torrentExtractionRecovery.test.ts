import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vite-plus/test";
import type { SessionJob } from "../../../../../server/domain/models.js";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { createRetainedTorrentStore } from "../../../../../server/repositories/retainedTorrents.js";
import { createRuntimeJobActions } from "../../../../../server/bootstrap/runtimeJobActions.js";
import { createSessionJobQueue } from "../../../../../server/application/jobs/sessionJobQueue.js";
import { restoreRetainedTorrents } from "../../../../../server/application/torrents/restoreRetainedTorrents.js";
import { extractSessionSource } from "../../../../../server/application/jobs/extractSessionSource.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";
import { zipBytes } from "../../../../fixtures/zipBytes.js";
import { restorePublishedArchiveSession } from "../../../../../server/application/jobs/restorePublishedArchiveSession.js";
import type { Session } from "../../../../../server/domain/models.js";

it("retries non-ZIP torrent extraction in the same owned workspace with verified pieces intact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "torrent-extraction-retry-"));
  const store = createRetainedTorrentStore(root);
  try {
    const jobs = new Map<string, SessionJob>();
    const manager = createJobManager(jobs, vi.fn(), store);
    const job = manager.createJob(`magnet:?xt=urn:btih:${"b".repeat(40)}`);
    const source = path.join(job.workspaceDir, "torrent", "archive.7z");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "verified source");
    Object.assign(job, {
      status: "error",
      phase: "error",
      torrentArchivePath: "archive.7z",
      torrentFiles: [
        {
          id: "0",
          path: "archive.7z",
          selected: true,
          complete: true,
          size: 15,
          downloadedBytes: 15,
        },
      ],
    });
    const queue = createSessionJobQueue({
      initialJobs: [job],
      pendingSessionJobs: [],
      getActiveSessionJobCount: () => 1,
      incrementActiveSessionJobCount: vi.fn(),
      decrementActiveSessionJobCount: vi.fn(),
      maxActiveSessionJobs: 1,
      processSessionJob: vi.fn(),
      emitJob: manager.emitJob,
      logEvent: vi.fn(),
    });
    const actions = createRuntimeJobActions(
      jobs,
      new Map(),
      new Map(),
      manager,
      queue,
      vi.fn(),
      async () => {},
    );
    const retried = actions.retrySessionJob(job);
    expect(retried.id).toBe(job.id);
    expect(jobs.size).toBe(1);
    expect(retried.torrentFiles[0]).toMatchObject({ complete: true, downloadedBytes: 15 });
    expect(await readFile(path.join(retried.workspaceDir, "torrent", "archive.7z"), "utf8")).toBe(
      "verified source",
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("restores a ready torrent archive at 100 percent after rebuilding verified output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "torrent-extraction-ready-"));
  const store = createRetainedTorrentStore(root);
  try {
    const jobs = new Map<string, SessionJob>();
    const manager = createJobManager(jobs, vi.fn(), store);
    const job = manager.createJob(`magnet:?xt=urn:btih:${"c".repeat(40)}`);
    const source = path.join(job.workspaceDir, "torrent", "archive.zip");
    job.extractDir = path.join(job.workspaceDir, "extracted");
    await mkdir(path.dirname(source), { recursive: true });
    await mkdir(job.extractDir);
    const payload = zipBytes([{ name: "ready.txt", data: Buffer.from("ready") }]);
    await writeFile(source, payload);
    job.torrentMetadata = new Uint8Array([1]);
    const files = [
      {
        id: "0",
        path: "archive.zip",
        selected: true,
        complete: true,
        size: payload.length,
        downloadedBytes: payload.length,
      },
    ];
    manager.emitJob(job, {
      status: "ready",
      phase: "ready",
      sessionId: randomUUID(),
      percent: 100,
      torrentFiles: files,
    });
    jobs.clear();
    await restoreRetainedTorrents(
      store,
      jobs,
      {
        close: vi.fn(),
        download: ({ onMetadata }) =>
          Promise.resolve().then(() => {
            onMetadata({ name: "archive", length: payload.length, files });
            return { files: ["archive.zip"] };
          }),
      },
      (restored) =>
        extractSessionSource(restored, source, restored.extractDir, {
          emitJob: manager.emitJob,
          detectEncryption: () => Promise.resolve(false),
          extractWith7zip: vi.fn(),
          listExtractedEntries,
        }),
    );
    expect(jobs.get(job.id)).toMatchObject({ status: "ready", phase: "ready", percent: 100 });
    expect(jobs.get(job.id)?.extraction).toBeUndefined();
    expect(await readFile(path.join(job.extractDir, "ready.txt"), "utf8")).toBe("ready");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("restores the last published non-ZIP torrent output when killed during cancellation cleanup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "torrent-extraction-cancel-"));
  const store = createRetainedTorrentStore(root);
  try {
    const jobs = new Map<string, SessionJob>();
    const sessions = new Map<string, Session>();
    const manager = createJobManager(jobs, vi.fn(), store);
    const job = manager.createJob(`magnet:?xt=urn:btih:${"d".repeat(40)}`);
    job.extractDir = path.join(job.workspaceDir, "extracted");
    await mkdir(job.extractDir, { recursive: true });
    await writeFile(path.join(job.extractDir, "published.txt"), "verified published output");
    await mkdir(`${job.extractDir}.staging`);
    await writeFile(path.join(`${job.extractDir}.staging`, "pending.txt"), "partial");
    job.torrentMetadata = new Uint8Array([1]);
    const files = [
      {
        id: "0",
        path: "archive.7z",
        selected: true,
        complete: true,
        size: 15,
        downloadedBytes: 15,
      },
    ];
    manager.emitJob(job, {
      status: "extracting",
      phase: "extracting",
      sessionId: randomUUID(),
      torrentArchivePath: "archive.7z",
      torrentFiles: files,
      extraction: {
        stage: "cancelling",
        completedEntries: 0,
        totalEntries: 1,
        expandedBytes: 7,
        totalExpandedBytes: 15,
        currentEntry: "pending.txt",
      },
    });
    jobs.clear();
    await restoreRetainedTorrents(
      store,
      jobs,
      {
        close: vi.fn(),
        download: ({ onMetadata }) =>
          Promise.resolve().then(() => {
            onMetadata({ name: "archive", length: 15, files });
            return { files: ["archive.7z"] };
          }),
      },
      (restored) =>
        restorePublishedArchiveSession(restored, { sessionStore: sessions, listExtractedEntries }),
    );
    expect(jobs.get(job.id)?.status).toBe("cancelled");
    expect(sessions.get(job.sessionId)?.stats.fileCount).toBe(1);
    expect(JSON.stringify(sessions.get(job.sessionId)?.tree)).toContain("published.txt");
    expect(JSON.stringify(sessions.get(job.sessionId)?.tree)).not.toContain("pending.txt");
    expect(await readFile(path.join(job.extractDir, "published.txt"), "utf8")).toBe(
      "verified published output",
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
