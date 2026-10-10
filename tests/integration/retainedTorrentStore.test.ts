import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createJobManager } from "../../server/application/jobs/jobManager.js";
import { createRetainedTorrentStore } from "../../server/repositories/retainedTorrents.js";
import { createSessionJobQueue } from "../../server/application/jobs/sessionJobQueue.js";
import { restoreRetainedTorrents } from "../../server/application/torrents/restoreRetainedTorrents.js";
import type { SessionJob } from "../../server/domain/models.js";

it("contains failed snapshot writes during progress, close, shutdown and restore", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "retained-full-"));
  const store = createRetainedTorrentStore(directory);
  const log = vi.fn();
  try {
    const jobs = new Map<string, SessionJob>();
    const manager = createJobManager(jobs, log, store);
    const job = manager.createJob("magnet:?xt=urn:btih:" + "a".repeat(40));
    manager.emitJob(job, { status: "paused", phase: "paused" });
    job.abortController = new AbortController();
    const response = { write: vi.fn(), end: vi.fn() };
    job.subscribers.add(response as unknown as import("express").Response);
    const save = vi.spyOn(store, "save").mockImplementation(() => {
      throw new Error("SQLITE_FULL: database or disk is full");
    });
    expect(() =>
      manager.emitJob(job, { status: "downloading", downloadedBytes: 1 }),
    ).not.toThrow();
    expect(job).toMatchObject({
      status: "error",
      phase: "error",
      canResume: false,
    });
    expect(job.abortController.signal.aborted).toBe(true);
    expect(job.abortController.signal.reason).toMatchObject({
      name: "RetainedTorrentStorageError",
    });
    expect(response.write).toHaveBeenCalledWith(
      expect.stringContaining("SQLITE_FULL"),
    );
    expect(response.end).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "error",
      "torrent.persistence.failed",
      expect.objectContaining({ jobId: job.id }),
    );
    expect(() => manager.closeJob(job, "ready")).not.toThrow();
    await expect(
      manager.cleanupJob(job.id, "shutdown"),
    ).resolves.toBeUndefined();
    jobs.clear();
    await expect(
      restoreRetainedTorrents(
        store,
        jobs,
        { download: vi.fn(), close: vi.fn() },
        vi.fn(),
      ),
    ).resolves.toBeUndefined();
    expect(jobs.get(job.id)?.status).toBe("error");
    expect(store.read()[0].job.status).toBe("paused");
    save.mockRestore();
    const restored = jobs.get(job.id);
    if (!restored) throw new Error("Restored job is missing");
    manager.emitJob(restored, { status: "paused", phase: "paused" });
    expect(store.read()[0].job.status).toBe("paused");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("bounds progress writes while immediately committing lifecycle and shutdown state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "retained-progress-"));
  const store = createRetainedTorrentStore(directory);
  vi.useFakeTimers();
  try {
    const manager = createJobManager(new Map(), vi.fn(), store);
    const job = manager.createJob(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    );
    manager.emitJob(job, { status: "downloading", phase: "downloading" });
    const save = vi.spyOn(store, "save");
    for (
      let downloadedBytes = 1;
      downloadedBytes <= 1_000;
      downloadedBytes += 1
    )
      manager.emitJob(job, { downloadedBytes });
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    manager.emitJob(job, { downloadedBytes: 1_001 });
    expect(save).toHaveBeenCalledTimes(2);
    manager.emitJob(job, { status: "paused", phase: "paused" });
    expect(store.read()[0].job.downloadedBytes).toBe(1_001);
    manager.emitJob(job, { status: "downloading", phase: "downloading" });
    manager.emitJob(job, { downloadedBytes: 1_002 });
    await manager.cleanupJob(job.id, "shutdown");
    expect(store.read()[0].job.downloadedBytes).toBe(1_002);
    manager.closeJob(job, "ready");
    expect(store.read()[0].job.status).toBe("ready");
  } finally {
    vi.useRealTimers();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("commits torrent metadata and state together and removes only the requested record", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "retained-torrents-"));
  let store = createRetainedTorrentStore(directory);
  try {
    const manager = createJobManager(new Map(), vi.fn());
    const job = manager.createJob(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    );
    job.torrentMetadata = new Uint8Array([1, 2, 3]);
    job.status = "paused";
    store.save(job);
    const other = manager.createJob(job.url);
    store.save(other);
    store.save(job);
    store.close();
    store = createRetainedTorrentStore(directory);
    expect(store.read().map(({ job: saved }) => saved.id)).toEqual([
      job.id,
      other.id,
    ]);
    expect(store.read()[0].metadata).toEqual(new Uint8Array([1, 2, 3]));
    expect(store.read()[0].job.status).toBe("paused");
    const queue = createSessionJobQueue({
      initialJobs: [job, other],
      pendingSessionJobs: [],
      maxActiveSessionJobs: 1,
      getActiveSessionJobCount: () => 0,
      incrementActiveSessionJobCount: vi.fn(),
      decrementActiveSessionJobCount: vi.fn(),
      processSessionJob: vi.fn(),
      emitJob: (changed) => store.save(changed),
      logEvent: vi.fn(),
    });
    queue.reorderSessionJobs([other.id, job.id]);
    store.close();
    store = createRetainedTorrentStore(directory);
    expect(store.read().map(({ job: saved }) => saved.id)).toEqual([
      other.id,
      job.id,
    ]);
    store.remove(job.id);
    expect(store.read().map(({ job: saved }) => saved.id)).toEqual([other.id]);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
