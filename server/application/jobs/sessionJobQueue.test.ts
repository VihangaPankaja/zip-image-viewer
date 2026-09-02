import { describe, expect, it, vi } from "vitest";
import type { SessionJob } from "../../domain/models.js";
import { createSessionJobQueue } from "./sessionJobQueue.js";

function createJob(id: string): SessionJob {
  return {
    id,
    url: `https://example.com/${id}.zip`,
    sourceKind: "http",
    sourcePreference: "auto",
    status: "queued",
    phase: "queued",
    percent: null,
    downloadedBytes: 0,
    reportedSize: 0,
    extractedEntries: 0,
    totalEntries: 0,
    downloadSpeedBytesPerSec: 0,
    averageSpeedBytesPerSec: 0,
    etaSeconds: null,
    isStalled: false,
    stallDurationMs: 0,
    retryCount: 0,
    maxRetries: 3,
    canResume: true,
    canPause: true,
    queuePosition: 0,
    pauseRequested: false,
    threadMode: "auto",
    threadCount: 2,
    peerCount: 0,
    verifiedBytes: 0,
    uploadedBytes: 0,
    uploadSpeedBytesPerSec: 0,
    enableMultithread: true,
    enableResume: true,
    message: "Queued",
    error: "",
    transcodedEntries: 0,
    totalTranscodeEntries: 0,
    videoQuality: "720p",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    zipPath: "",
    workspaceDir: "",
    sessionId: "",
    requiresConfirmation: false,
    cleanupAt: 0,
    abortController: null,
    extractDir: "",
    downloadOptions: {
      transport: { mode: "auto", threads: 2, multithread: true, resume: true },
      retry: { maxRetries: 3, timeoutMs: 30_000 },
      media: { videoQuality: "720p" },
      extraction: { enabled: true },
      request: { headers: {} },
    },
    subscribers: new Set(),
    socketSubscribers: new Set(),
  };
}

function queueDependencies(maxActiveSessionJobs: number) {
  let active = 0;
  return {
    pendingSessionJobs: [],
    getActiveSessionJobCount: () => active,
    incrementActiveSessionJobCount: () => {
      active += 1;
    },
    decrementActiveSessionJobCount: () => {
      active -= 1;
    },
    maxActiveSessionJobs,
    processSessionJob: vi.fn(() => Promise.resolve()),
    logEvent: vi.fn(),
  };
}

describe("createSessionJobQueue", () => {
  it.each([0, 9, 1.5, Number.NaN])("rejects worker limit %s", (limit) => {
    expect(() => createSessionJobQueue(queueDependencies(limit))).toThrow(
      "Session job concurrency must be between one and eight.",
    );
  });

  it.each([1, 2, 8])("accepts worker limit %s", (limit) => {
    expect(() => createSessionJobQueue(queueDependencies(limit))).not.toThrow();
  });

  it("holds the third job until one of two active workers completes", async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const dependencies = {
      pendingSessionJobs: [] as Array<{
        job: SessionJob;
        confirmOversize: boolean;
      }>,
      getActiveSessionJobCount: () => active,
      incrementActiveSessionJobCount: () => {
        active += 1;
        peak = Math.max(peak, active);
      },
      decrementActiveSessionJobCount: () => {
        active -= 1;
      },
      maxActiveSessionJobs: 2,
      processSessionJob: vi.fn(
        () => new Promise<void>((resolve) => releases.push(resolve)),
      ),
      logEvent: vi.fn(),
    };
    const queue = createSessionJobQueue(dependencies);

    queue.enqueueSessionJob(createJob("one"), false);
    queue.enqueueSessionJob(createJob("two"), false);
    queue.enqueueSessionJob(createJob("three"), false);

    expect(dependencies.processSessionJob).toHaveBeenCalledTimes(2);
    releases.shift()?.();
    await vi.waitFor(() =>
      expect(dependencies.processSessionJob).toHaveBeenCalledTimes(3),
    );
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(active).toBe(0));
    expect(peak).toBe(2);
  });

  it("starts waiting work when concurrency increases", async () => {
    let active = 0;
    const releases: Array<() => void> = [];
    const dependencies = {
      pendingSessionJobs: [] as Array<{
        job: SessionJob;
        confirmOversize: boolean;
      }>,
      getActiveSessionJobCount: () => active,
      incrementActiveSessionJobCount: () => {
        active += 1;
      },
      decrementActiveSessionJobCount: () => {
        active -= 1;
      },
      maxActiveSessionJobs: 1,
      processSessionJob: vi.fn(
        () => new Promise<void>((resolve) => releases.push(resolve)),
      ),
      logEvent: vi.fn(),
    };
    const queue = createSessionJobQueue(dependencies);

    queue.enqueueSessionJob(createJob("one"), false);
    queue.enqueueSessionJob(createJob("two"), false);
    expect(dependencies.processSessionJob).toHaveBeenCalledTimes(1);

    queue.setMaxActiveSessionJobs(2);
    expect(dependencies.processSessionJob).toHaveBeenCalledTimes(2);
    expect(queue.getSchedulerState()).toEqual({
      activeCount: 2,
      maxConcurrent: 2,
    });

    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(active).toBe(0));
  });

  it("uses authoritative order when choosing the next waiting job", async () => {
    let active = 0;
    const releases: Array<() => void> = [];
    const dependencies = {
      pendingSessionJobs: [] as Array<{
        job: SessionJob;
        confirmOversize: boolean;
      }>,
      getActiveSessionJobCount: () => active,
      incrementActiveSessionJobCount: () => {
        active += 1;
      },
      decrementActiveSessionJobCount: () => {
        active -= 1;
      },
      maxActiveSessionJobs: 1,
      processSessionJob: vi.fn(
        () => new Promise<void>((resolve) => releases.push(resolve)),
      ),
      logEvent: vi.fn(),
    };
    const queue = createSessionJobQueue(dependencies);
    queue.enqueueSessionJob(createJob("one"), false);
    queue.enqueueSessionJob(createJob("two"), false);
    queue.enqueueSessionJob(createJob("three"), false);

    queue.reorderSessionJobs(["one", "three", "two"]);
    releases.shift()?.();
    await vi.waitFor(() =>
      expect(dependencies.processSessionJob).toHaveBeenCalledTimes(2),
    );
    expect(dependencies.processSessionJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "three" }),
      false,
    );

    releases.shift()?.();
    await vi.waitFor(() =>
      expect(dependencies.processSessionJob).toHaveBeenCalledTimes(3),
    );
    releases.shift()?.();
    await vi.waitFor(() => expect(active).toBe(0));
  });

  it("rejects an order that omits or invents jobs", () => {
    const dependencies = queueDependencies(1);
    const queue = createSessionJobQueue(dependencies);
    queue.enqueueSessionJob(createJob("one"), false);
    queue.enqueueSessionJob(createJob("two"), false);

    expect(() => queue.reorderSessionJobs(["one"])).toThrow(
      "Job order must contain every job exactly once.",
    );
    expect(() => queue.reorderSessionJobs(["one", "two", "unknown"])).toThrow(
      "Job order must contain every job exactly once.",
    );
  });

  it("preempts the lowest-priority resumable job", async () => {
    let active = 0;
    const releases = new Map<string, () => void>();
    const first = createJob("one");
    const second = createJob("two");
    const dependencies = {
      pendingSessionJobs: [] as Array<{
        job: SessionJob;
        confirmOversize: boolean;
      }>,
      getActiveSessionJobCount: () => active,
      incrementActiveSessionJobCount: () => {
        active += 1;
      },
      decrementActiveSessionJobCount: () => {
        active -= 1;
      },
      maxActiveSessionJobs: 1,
      processSessionJob: vi.fn(
        (job: SessionJob) =>
          new Promise<void>((resolve) => {
            job.status = "downloading";
            releases.set(job.id, resolve);
          }),
      ),
      pauseJob: vi.fn((job: SessionJob) => {
        job.status = "paused";
        releases.get(job.id)?.();
        return Promise.resolve();
      }),
      logEvent: vi.fn(),
    };
    const queue = createSessionJobQueue(dependencies);
    queue.enqueueSessionJob(first, false);
    queue.enqueueSessionJob(second, false);

    queue.reorderSessionJobs(["two", "one"]);

    await vi.waitFor(() =>
      expect(dependencies.pauseJob).toHaveBeenCalledWith(first),
    );
    await vi.waitFor(() =>
      expect(dependencies.processSessionJob).toHaveBeenLastCalledWith(
        second,
        false,
      ),
    );
    second.status = "ready";
    releases.get(second.id)?.();
    await vi.waitFor(() =>
      expect(dependencies.processSessionJob).toHaveBeenCalledTimes(3),
    );
    first.status = "ready";
    releases.get(first.id)?.();
    await vi.waitFor(() => expect(active).toBe(0));
  });

  it("pauses and resumes the same job without losing its order", async () => {
    let active = 0;
    let release: (() => void) | undefined;
    const job = createJob("one");
    const dependencies = {
      pendingSessionJobs: [] as Array<{
        job: SessionJob;
        confirmOversize: boolean;
      }>,
      getActiveSessionJobCount: () => active,
      incrementActiveSessionJobCount: () => {
        active += 1;
      },
      decrementActiveSessionJobCount: () => {
        active -= 1;
      },
      maxActiveSessionJobs: 1,
      processSessionJob: vi.fn(
        () => new Promise<void>((resolve) => (release = resolve)),
      ),
      pauseJob: vi.fn((activeJob: SessionJob) => {
        activeJob.status = "paused";
        release?.();
        return Promise.resolve();
      }),
      logEvent: vi.fn(),
    };
    const queue = createSessionJobQueue(dependencies);
    queue.enqueueSessionJob(job, false);

    await queue.pauseSessionJob(job.id);
    await vi.waitFor(() => expect(active).toBe(0));
    expect(dependencies.processSessionJob).toHaveBeenCalledTimes(1);

    queue.resumeSessionJob(job.id);
    expect(dependencies.processSessionJob).toHaveBeenCalledTimes(2);
    expect(queue.getOrderedJobs()).toEqual([
      expect.objectContaining({ id: job.id, queuePosition: 0 }),
    ]);
    job.status = "ready";
    release?.();
    await vi.waitFor(() => expect(active).toBe(0));
  });

  it("cancels waiting work before it can start and removes terminal history", async () => {
    let release: (() => void) | undefined;
    const dependencies = queueDependencies(1);
    dependencies.processSessionJob.mockImplementation(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const first = createJob("one");
    const second = createJob("two");
    const queue = createSessionJobQueue(dependencies);
    queue.enqueueSessionJob(first, false);
    queue.enqueueSessionJob(second, false);

    expect(() => queue.removeSessionJob(second.id)).toThrow(
      "Only completed jobs can be removed.",
    );
    expect(queue.cancelSessionJob(second.id).status).toBe("cancelled");
    release?.();
    await vi.waitFor(() =>
      expect(dependencies.processSessionJob).toHaveBeenCalledTimes(1),
    );
    queue.removeSessionJob(second.id);

    expect(queue.getJobOrder()).toEqual([first.id]);
  });

  it("logs rejected jobs and continues draining the queue", async () => {
    const dependencies = queueDependencies(1);
    dependencies.processSessionJob
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce(undefined);
    const queue = createSessionJobQueue(dependencies);

    queue.enqueueSessionJob(createJob("failed"), false);
    queue.enqueueSessionJob(createJob("next"), false);

    await vi.waitFor(() =>
      expect(dependencies.processSessionJob).toHaveBeenCalledTimes(2),
    );
    expect(dependencies.logEvent).toHaveBeenCalledWith(
      "error",
      "job.process.unhandled",
      expect.objectContaining({ jobId: "failed", error: "network failed" }),
    );
  });

  it("forwards confirmation and normalizes a non-error rejection", async () => {
    const dependencies = queueDependencies(1);
    dependencies.processSessionJob.mockRejectedValueOnce("failed");
    const queue = createSessionJobQueue(dependencies);
    queue.enqueueSessionJob(createJob("confirmed"), true);
    await vi.waitFor(() => expect(dependencies.logEvent).toHaveBeenCalled());
    expect(dependencies.processSessionJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "confirmed" }),
      true,
    );
    expect(dependencies.logEvent).toHaveBeenCalledWith(
      "error",
      "job.process.unhandled",
      expect.objectContaining({ error: "Unknown" }),
    );
  });

  it("stops safely if a pending queue becomes inconsistent", () => {
    const dependencies = queueDependencies(1);
    dependencies.pendingSessionJobs.shift = () => undefined;
    const queue = createSessionJobQueue(dependencies);
    queue.enqueueSessionJob(createJob("ignored"), false);
    expect(dependencies.processSessionJob).not.toHaveBeenCalled();
  });
});
