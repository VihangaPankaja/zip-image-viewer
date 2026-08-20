import { describe, expect, it, vi } from "vitest";
import type { SessionJob } from "../../domain/models.js";
import { createSessionJobQueue } from "./sessionJobQueue.js";

function createJob(id: string): SessionJob {
  return {
    id,
    url: `https://example.com/${id}.zip`,
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
    threadMode: "auto",
    threadCount: 2,
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
  it.each([0, 3, 1.5, Number.NaN])("rejects worker limit %s", (limit) => {
    expect(() => createSessionJobQueue(queueDependencies(limit))).toThrow(
      "Session job concurrency must be one or two.",
    );
  });

  it("accepts the global two-worker limit", () => {
    expect(() => createSessionJobQueue(queueDependencies(2))).not.toThrow();
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
