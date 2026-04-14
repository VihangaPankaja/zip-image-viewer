type QueueItem = {
  job: { id: string };
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
  logEvent,
}: SessionJobQueueDeps) {
  function scheduleSessionJobs() {
    while (
      getActiveSessionJobCount() < maxActiveSessionJobs &&
      pendingSessionJobs.length > 0
    ) {
      const next = pendingSessionJobs.shift();
      if (!next) {
        break;
      }

      incrementActiveSessionJobCount();
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
          decrementActiveSessionJobCount();
          scheduleSessionJobs();
        });
    }
  }

  function enqueueSessionJob(job: QueueItem["job"], confirmOversize: boolean) {
    pendingSessionJobs.push({ job, confirmOversize });
    scheduleSessionJobs();
  }

  return {
    enqueueSessionJob,
  };
}
