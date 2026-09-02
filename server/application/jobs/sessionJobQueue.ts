import type { SessionJob } from "../../domain/models.js";

type QueueItem = {
  job: SessionJob;
  confirmOversize: boolean;
};

type SessionJobQueueDeps = {
  pendingSessionJobs: QueueItem[];
  getActiveSessionJobCount: () => number;
  incrementActiveSessionJobCount: () => void;
  decrementActiveSessionJobCount: () => void;
  maxActiveSessionJobs: number;
  processSessionJob: (
    _job: QueueItem["job"],
    _confirmOversize: boolean,
  ) => Promise<void>;
  pauseJob?: (_job: QueueItem["job"]) => Promise<void>;
  logEvent: (
    _level: "info" | "warn" | "error",
    _event: string,
    _details?: Record<string, unknown>,
  ) => void;
};

export function createSessionJobQueue({
  pendingSessionJobs,
  getActiveSessionJobCount,
  incrementActiveSessionJobCount,
  decrementActiveSessionJobCount,
  maxActiveSessionJobs,
  processSessionJob,
  pauseJob,
  logEvent,
}: SessionJobQueueDeps) {
  function validateConcurrency(value: number): void {
    if (Number.isInteger(value) && value >= 1 && value <= 8) return;
    throw new RangeError(
      "Session job concurrency must be between one and eight.",
    );
  }
  validateConcurrency(maxActiveSessionJobs);
  let maxConcurrent = maxActiveSessionJobs;
  const activeItems = new Map<string, QueueItem>();
  const jobs = new Map<string, QueueItem>();
  const jobOrder: string[] = [];
  const pausing = new Set<string>();
  const requeueAfterPause = new Set<string>();

  function refreshPositions(): void {
    jobOrder.forEach((id, index) => {
      const item = jobs.get(id);
      if (item) item.job.queuePosition = index;
    });
  }

  function sortPending(): void {
    const positions = new Map(jobOrder.map((id, index) => [id, index]));
    pendingSessionJobs.sort(
      (left, right) =>
        (positions.get(left.job.id) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(right.job.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  function scheduleSessionJobs() {
    while (
      getActiveSessionJobCount() < maxConcurrent &&
      pendingSessionJobs.length > 0
    ) {
      const next = pendingSessionJobs.shift();
      if (!next) {
        break;
      }

      incrementActiveSessionJobCount();
      activeItems.set(next.job.id, next);
      processSessionJob(next.job, next.confirmOversize)
        .catch((error: unknown) => {
          const jobError =
            error instanceof Error ? error : new Error("Unknown");
          logEvent("error", "job.process.unhandled", {
            jobId: next.job.id,
            error: jobError.message,
            stack: jobError.stack,
          });
        })
        .finally(() => {
          activeItems.delete(next.job.id);
          pausing.delete(next.job.id);
          decrementActiveSessionJobCount();
          if (requeueAfterPause.delete(next.job.id)) {
            pendingSessionJobs.push(next);
            sortPending();
          }
          scheduleSessionJobs();
        });
    }
  }

  function enqueueSessionJob(job: QueueItem["job"], confirmOversize: boolean) {
    const item = { job, confirmOversize };
    jobs.set(job.id, item);
    if (!jobOrder.includes(job.id)) jobOrder.push(job.id);
    refreshPositions();
    pendingSessionJobs.push(item);
    sortPending();
    scheduleSessionJobs();
  }

  function setMaxActiveSessionJobs(value: number): void {
    validateConcurrency(value);
    maxConcurrent = value;
    scheduleSessionJobs();
  }

  function reorderSessionJobs(jobIds: readonly string[]): void {
    if (
      jobIds.length !== jobs.size ||
      new Set(jobIds).size !== jobIds.length ||
      jobIds.some((id) => !jobs.has(id))
    ) {
      throw new Error("Job order must contain every job exactly once.");
    }
    jobOrder.splice(0, jobOrder.length, ...jobIds);
    refreshPositions();
    sortPending();
    const firstPending = pendingSessionJobs[0];
    if (!firstPending || !pauseJob || activeItems.size < maxConcurrent) return;
    const pendingPosition = jobOrder.indexOf(firstPending.job.id);
    const candidate = [...activeItems.values()]
      .filter(
        ({ job }) =>
          job.canResume &&
          !pausing.has(job.id) &&
          jobOrder.indexOf(job.id) > pendingPosition,
      )
      .sort(
        (left, right) =>
          jobOrder.indexOf(right.job.id) - jobOrder.indexOf(left.job.id),
      )[0];
    if (!candidate) return;
    pausing.add(candidate.job.id);
    requeueAfterPause.add(candidate.job.id);
    candidate.job.pauseRequested = true;
    void pauseJob(candidate.job).catch((error: unknown) => {
      pausing.delete(candidate.job.id);
      requeueAfterPause.delete(candidate.job.id);
      logEvent("error", "job.pause.failed", {
        jobId: candidate.job.id,
        error: error instanceof Error ? error.message : "Unknown",
      });
    });
  }

  async function pauseSessionJob(jobId: string): Promise<SessionJob> {
    const item = activeItems.get(jobId);
    if (!item || !pauseJob || !item.job.canPause) {
      throw new Error("Job cannot be paused.");
    }
    item.job.pauseRequested = true;
    pausing.add(jobId);
    await pauseJob(item.job);
    return item.job;
  }

  function resumeSessionJob(jobId: string): SessionJob {
    const item = jobs.get(jobId);
    if (!item || item.job.status !== "paused") {
      throw new Error("Only paused jobs can be resumed.");
    }
    Object.assign(item.job, {
      status: "queued",
      phase: "queued",
      message: "Waiting to resume",
      canPause: false,
    });
    if (!pendingSessionJobs.some(({ job }) => job.id === jobId)) {
      pendingSessionJobs.push(item);
      sortPending();
    }
    scheduleSessionJobs();
    return item.job;
  }

  function cancelSessionJob(jobId: string): SessionJob {
    const item = jobs.get(jobId);
    if (!item) throw new Error("Job not found.");
    const pendingIndex = pendingSessionJobs.findIndex(
      ({ job }) => job.id === jobId,
    );
    if (pendingIndex >= 0) pendingSessionJobs.splice(pendingIndex, 1);
    item.job.pauseRequested = false;
    item.job.abortController?.abort();
    Object.assign(item.job, {
      status: "cancelled",
      phase: "cancelled",
      canPause: false,
      message: "Cancelled",
    });
    return item.job;
  }

  function removeSessionJob(jobId: string): SessionJob {
    const item = jobs.get(jobId);
    if (!item) throw new Error("Job not found.");
    if (
      activeItems.has(jobId) ||
      pendingSessionJobs.some(({ job }) => job.id === jobId)
    ) {
      throw new Error("Only completed jobs can be removed.");
    }
    jobs.delete(jobId);
    const orderIndex = jobOrder.indexOf(jobId);
    if (orderIndex >= 0) jobOrder.splice(orderIndex, 1);
    refreshPositions();
    return item.job;
  }

  return {
    cancelSessionJob,
    enqueueSessionJob,
    getSchedulerState: () => ({
      activeCount: getActiveSessionJobCount(),
      maxConcurrent,
    }),
    getJobOrder: () => [...jobOrder],
    getOrderedJobs: () =>
      jobOrder.flatMap((id) => {
        const item = jobs.get(id);
        return item ? [item.job] : [];
      }),
    pauseSessionJob,
    reorderSessionJobs,
    removeSessionJob,
    resumeSessionJob,
    setMaxActiveSessionJobs,
  };
}
