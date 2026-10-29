import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vite-plus/test";
import type { Session, SessionJob } from "../../../../server/domain/models.js";
import { createJobManager } from "../../../../server/application/jobs/jobManager.js";
import { createSessionJobQueue } from "../../../../server/application/jobs/sessionJobQueue.js";
import { createRuntimeJobActions } from "../../../../server/bootstrap/runtimeJobActions.js";
import { createRetainedTorrentStore } from "../../../../server/repositories/retainedTorrents.js";

it.each([
  { sourceKind: "http", expired: false },
  { sourceKind: "torrent", expired: false },
  { sourceKind: "http", expired: true },
])(
  "explicitly deletes $sourceKind files and queue entry with expired job: $expired",
  async ({ sourceKind, expired }) => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "delete-session-job-"));
    const jobs = new Map<string, SessionJob>();
    const manager = createJobManager(jobs, vi.fn());
    const job = manager.createJob("https://example.com/media.zip");
    Object.assign(job, {
      sourceKind,
      status: "ready",
      workspaceDir,
      sessionId: "session",
    });
    const session = {
      id: job.sessionId,
      workspaceDir,
      retained: sourceKind === "torrent",
      pinned: expired,
    } as Session;
    const sessions = new Map([[session.id, session]]);
    const queue = createSessionJobQueue({
      initialJobs: [job],
      pendingSessionJobs: [],
      getActiveSessionJobCount: () => 0,
      incrementActiveSessionJobCount: vi.fn(),
      decrementActiveSessionJobCount: vi.fn(),
      maxActiveSessionJobs: 2,
      processSessionJob: () => Promise.resolve(),
      logEvent: vi.fn(),
    });
    const removeSessionJob = vi.spyOn(queue, "removeSessionJob");
    const actions = createRuntimeJobActions(
      jobs,
      sessions,
      new Map(),
      manager,
      queue,
      vi.fn(),
      () => Promise.resolve(),
    );
    try {
      if (expired) {
        await actions.removeSession(session.id, "expired");
        await manager.cleanupJob(job.id, "expired");
        expect(sessions.has(session.id)).toBe(true);
        expect(jobs.size).toBe(0);
      }
      await actions.removeSession(session.id, "rpc");
      expect(jobs.size).toBe(0);
      expect(sessions.size).toBe(0);
      expect(removeSessionJob).toHaveBeenCalledWith(job.id);
      expect(queue.getOrderedJobs()).toEqual([]);
      await expect(stat(workspaceDir)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  },
);

it.each(["pending", "active"])(
  "rejects deletion of a %s retained torrent without removing files or state",
  async (phase) => {
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "busy-session-delete-"));
    const jobs = new Map<string, SessionJob>();
    const manager = createJobManager(jobs, vi.fn());
    const job = manager.createJob("https://example.com/media.torrent");
    Object.assign(job, {
      workspaceDir,
      sessionId: "session",
      sourceKind: "torrent",
    });
    const session = {
      id: job.sessionId,
      workspaceDir,
      retained: true,
    } as Session;
    const sessions = new Map([[session.id, session]]);
    let finish = () => {};
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const queue = createSessionJobQueue({
      pendingSessionJobs: [],
      getActiveSessionJobCount: () => (phase === "pending" ? 2 : 0),
      incrementActiveSessionJobCount: vi.fn(),
      decrementActiveSessionJobCount: vi.fn(),
      maxActiveSessionJobs: 2,
      processSessionJob: () => running,
      logEvent: vi.fn(),
    });
    queue.enqueueSessionJob(job, false);
    const cleanup = vi.fn(() => Promise.resolve());
    const actions = createRuntimeJobActions(
      jobs,
      sessions,
      new Map(),
      manager,
      queue,
      vi.fn(),
      cleanup,
    );
    try {
      const deletion = actions.removeSession(session.id, "rpc");
      await expect(deletion).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
      });
      await expect(deletion).rejects.toThrow("Pause or cancel");
      expect((await stat(workspaceDir)).isDirectory()).toBe(true);
      expect(sessions.get(session.id)).toBe(session);
      expect(jobs.get(job.id)).toBe(job);
      expect(queue.getOrderedJobs()).toEqual([job]);
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      finish();
      await queue.stopSessionJobs();
      await rm(workspaceDir, { recursive: true, force: true });
    }
  },
);

it.each(["cancelled", "error"] as const)(
  "retries a %s torrent ZIP extraction with the same source, selection and job",
  async (status) => {
    const directory = await mkdtemp(path.join(tmpdir(), "retry-zip-job-"));
    const store = createRetainedTorrentStore(directory);
    try {
      const jobs = new Map<string, SessionJob>();
      const manager = createJobManager(jobs, vi.fn(), store);
      const previous = manager.createJob(`magnet:?xt=urn:btih:${"a".repeat(40)}`);
      const fingerprint = "a".repeat(64);
      manager.emitJob(previous, {
        status,
        phase: status,
        error: "Insufficient storage",
        archive: {
          fingerprint,
          sourceBytes: 32,
          compressedBytes: 8,
          expandedBytes: 16,
          fileCount: 2,
          extractedCount: 1,
        },
        zipSelection: { fingerprint, selectedIds: ["0", "1"], extractedIds: ["0"] },
      });
      const create = vi.spyOn(manager, "createJob");
      const queue = createSessionJobQueue({
        initialJobs: [previous],
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
        () => Promise.resolve(),
      );
      const selection = previous.zipSelection;
      expect(actions.retrySessionJob(previous)).toBe(previous);
      expect(create).not.toHaveBeenCalled();
      expect(jobs.size).toBe(1);
      expect(queue.getOrderedJobs()).toEqual([previous]);
      expect(previous.zipSelection).toBe(selection);
      expect(previous.status).toBe("queued");
      expect(previous.error).toBe("");
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
