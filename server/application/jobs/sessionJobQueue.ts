import { ApplicationError, type SessionJob } from "../../domain/models.js";

type QueueItem = { job: SessionJob; confirmOversize: boolean };

type SessionJobQueueDeps = {
  pendingSessionJobs: QueueItem[];
  initialJobs?: readonly SessionJob[];
  emitJob?: (_job: SessionJob, _patch: Partial<SessionJob>) => void;
  getActiveSessionJobCount: () => number;
  incrementActiveSessionJobCount: () => void;
  decrementActiveSessionJobCount: () => void;
  maxActiveSessionJobs: number;
  processSessionJob: (job: SessionJob, confirmed: boolean) => Promise<void>;
  pauseJob?: (job: SessionJob) => Promise<void>;
  logEvent: (
    level: "info" | "warn" | "error",
    event: string,
    details?: Record<string, unknown>,
  ) => void;
};

type QueueState = SessionJobQueueDeps & {
  maxConcurrent: number;
  activeItems: Map<string, QueueItem>;
  jobs: Map<string, QueueItem>;
  jobOrder: string[];
  pausing: Set<string>;
  requeueAfterActive: Set<string>;
  stopping: boolean;
  running: Set<Promise<void>>;
};

function validateConcurrency(value: number): void {
  if (Number.isInteger(value) && value >= 1 && value <= 8) return;
  throw new RangeError(
    "Session job concurrency must be between one and eight.",
  );
}

function refreshPositions(state: QueueState): void {
  state.jobOrder.forEach((id, index) => {
    const item = state.jobs.get(id);
    if (item && item.job.queuePosition !== index) {
      item.job.queuePosition = index;
      state.emitJob?.(item.job, {});
    }
  });
}

function sortPending(state: QueueState): void {
  const positions = new Map(state.jobOrder.map((id, index) => [id, index]));
  state.pendingSessionJobs.sort(
    (left, right) =>
      (positions.get(left.job.id) ?? Number.MAX_SAFE_INTEGER) -
      (positions.get(right.job.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function scheduleSessionJobs(state: QueueState): void {
  if (state.stopping) return;
  while (
    state.getActiveSessionJobCount() < state.maxConcurrent &&
    state.pendingSessionJobs.length > 0
  ) {
    const next = state.pendingSessionJobs.shift();
    if (!next) break;
    state.incrementActiveSessionJobCount();
    state.activeItems.set(next.job.id, next);
    const task = state
      .processSessionJob(next.job, next.confirmOversize)
      .catch((error: unknown) => {
        const jobError = error instanceof Error ? error : new Error("Unknown");
        state.logEvent("error", "job.process.unhandled", {
          jobId: next.job.id,
          error: jobError.message,
          stack: jobError.stack,
        });
      })
      .finally(() => {
        state.running.delete(task);
        state.activeItems.delete(next.job.id);
        state.pausing.delete(next.job.id);
        state.decrementActiveSessionJobCount();
        if (state.requeueAfterActive.delete(next.job.id)) {
          state.pendingSessionJobs.push(next);
          sortPending(state);
        }
        scheduleSessionJobs(state);
      });
    state.running.add(task);
  }
}

function enqueueSessionJob(
  state: QueueState,
  job: SessionJob,
  confirmOversize: boolean,
): void {
  const item = { job, confirmOversize };
  state.jobs.set(job.id, item);
  if (!state.jobOrder.includes(job.id)) state.jobOrder.push(job.id);
  refreshPositions(state);
  state.pendingSessionJobs.push(item);
  sortPending(state);
  scheduleSessionJobs(state);
}

function setMaxActiveSessionJobs(state: QueueState, value: number): void {
  validateConcurrency(value);
  state.maxConcurrent = value;
  scheduleSessionJobs(state);
}

function reorderSessionJobs(
  state: QueueState,
  jobIds: readonly string[],
): void {
  if (
    jobIds.length !== state.jobs.size ||
    new Set(jobIds).size !== jobIds.length ||
    jobIds.some((id) => !state.jobs.has(id))
  ) {
    throw new Error("Job order must contain every job exactly once.");
  }
  state.jobOrder.splice(0, state.jobOrder.length, ...jobIds);
  refreshPositions(state);
  sortPending(state);
  const firstPending = state.pendingSessionJobs.at(0);
  const pauseJob = state.pauseJob;
  if (
    !firstPending ||
    !pauseJob ||
    state.activeItems.size < state.maxConcurrent
  )
    return;
  const pendingPosition = state.jobOrder.indexOf(firstPending.job.id);
  const candidate = [...state.activeItems.values()]
    .filter(
      ({ job }) =>
        job.canResume &&
        !state.pausing.has(job.id) &&
        state.jobOrder.indexOf(job.id) > pendingPosition,
    )
    .sort(
      (left, right) =>
        state.jobOrder.indexOf(right.job.id) -
        state.jobOrder.indexOf(left.job.id),
    )
    .at(0);
  if (!candidate) return;
  state.pausing.add(candidate.job.id);
  state.requeueAfterActive.add(candidate.job.id);
  candidate.job.pauseRequested = true;
  void pauseJob(candidate.job).catch((error: unknown) => {
    state.pausing.delete(candidate.job.id);
    state.requeueAfterActive.delete(candidate.job.id);
    state.logEvent("error", "job.pause.failed", {
      jobId: candidate.job.id,
      error: error instanceof Error ? error.message : "Unknown",
    });
  });
}

async function pauseSessionJob(
  state: QueueState,
  jobId: string,
): Promise<SessionJob> {
  const item = state.activeItems.get(jobId);
  const pauseJob = state.pauseJob;
  if (!item || !pauseJob || !item.job.canPause)
    throw new Error("Job cannot be paused.");
  item.job.pauseRequested = true;
  state.pausing.add(jobId);
  await pauseJob(item.job);
  return item.job;
}

function resumeSessionJob(state: QueueState, jobId: string): SessionJob {
  const item = state.jobs.get(jobId);
  if (!item || item.job.status !== "paused")
    throw new Error("Only paused jobs can be resumed.");
  Object.assign(item.job, {
    status: "queued",
    phase: "queued",
    message: "Waiting to resume",
    canPause: false,
  });
  if (state.activeItems.has(jobId)) state.requeueAfterActive.add(jobId);
  else if (!state.pendingSessionJobs.some(({ job }) => job.id === jobId)) {
    state.pendingSessionJobs.push(item);
    sortPending(state);
  }
  scheduleSessionJobs(state);
  return item.job;
}

function confirmSessionJob(state: QueueState, jobId: string): SessionJob {
  const item = state.jobs.get(jobId);
  if (!item) throw new ApplicationError("NOT_FOUND", "Job not found.", 404);
  if (
    item.job.status !== "awaiting_confirmation" ||
    !item.job.requiresConfirmation
  ) {
    throw new ApplicationError(
      "CONFLICT",
      "Job is not awaiting confirmation.",
      409,
    );
  }
  Object.assign(item.job, {
    status: "queued",
    phase: "queued",
    requiresConfirmation: false,
    cleanupAt: 0,
    message: "Confirmation accepted. Waiting to start.",
  });
  item.confirmOversize = true;
  if (state.activeItems.has(jobId)) {
    state.requeueAfterActive.add(jobId);
  } else {
    state.pendingSessionJobs.push(item);
    sortPending(state);
    scheduleSessionJobs(state);
  }
  return item.job;
}

function selectTorrentFiles(
  state: QueueState,
  jobId: string,
  fileIds: string[],
): SessionJob {
  const item = state.jobs.get(jobId);
  if (!item) throw new ApplicationError("NOT_FOUND", "Job not found.", 404);
  if (
    item.job.sourceKind !== "torrent" ||
    !["awaiting_selection", "ready", "paused"].includes(item.job.status)
  ) {
    throw new ApplicationError(
      "CONFLICT",
      "Job is not awaiting file selection.",
      409,
    );
  }
  const ids = new Set(fileIds);
  const known = new Set(item.job.torrentFiles.map((file) => file.id));
  if (
    !ids.size ||
    ids.size !== fileIds.length ||
    fileIds.some((id) => !known.has(id))
  ) {
    throw new ApplicationError(
      "INVALID_INPUT",
      "Choose one or more known torrent files.",
      400,
    );
  }
  item.job.torrentFiles = item.job.torrentFiles.map((file) => ({
    ...file,
    selected:
      ids.has(file.id) ||
      (item.job.status !== "awaiting_selection" && file.selected),
  }));
  Object.assign(item.job, {
    status: "queued",
    phase: "queued",
    cleanupAt: 0,
    reportedSize: item.job.torrentFiles
      .filter((file) => file.selected)
      .reduce((total, file) => total + file.size, 0),
    message: "File selection accepted. Waiting to start.",
  });
  state.emitJob?.(item.job, {});
  if (state.activeItems.has(jobId)) state.requeueAfterActive.add(jobId);
  else {
    state.pendingSessionJobs.push(item);
    sortPending(state);
    scheduleSessionJobs(state);
  }
  return item.job;
}

function cancelSessionJob(state: QueueState, jobId: string): SessionJob {
  const item = state.jobs.get(jobId);
  if (!item) throw new Error("Job not found.");
  const pendingIndex = state.pendingSessionJobs.findIndex(
    ({ job }) => job.id === jobId,
  );
  if (pendingIndex >= 0) state.pendingSessionJobs.splice(pendingIndex, 1);
  state.requeueAfterActive.delete(jobId);
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

function removeSessionJob(state: QueueState, jobId: string): SessionJob {
  const item = state.jobs.get(jobId);
  if (!item) throw new Error("Job not found.");
  if (
    state.activeItems.has(jobId) ||
    state.pendingSessionJobs.some(({ job }) => job.id === jobId)
  ) {
    throw new Error("Only completed jobs can be removed.");
  }
  state.jobs.delete(jobId);
  const orderIndex = state.jobOrder.indexOf(jobId);
  if (orderIndex >= 0) state.jobOrder.splice(orderIndex, 1);
  refreshPositions(state);
  return item.job;
}

export function createSessionJobQueue(deps: SessionJobQueueDeps) {
  validateConcurrency(deps.maxActiveSessionJobs);
  const state: QueueState = {
    ...deps,
    maxConcurrent: deps.maxActiveSessionJobs,
    activeItems: new Map(),
    jobs: new Map(
      (deps.initialJobs ?? []).map((job) => [
        job.id,
        { job, confirmOversize: false },
      ]),
    ),
    jobOrder: (deps.initialJobs ?? []).map(({ id }) => id),
    pausing: new Set(),
    requeueAfterActive: new Set(),
    stopping: false,
    running: new Set(),
  };
  return {
    stopSessionJobs: async () => {
      state.stopping = true;
      for (const { job } of state.activeItems.values()) {
        job.pauseRequested = true;
        job.abortController?.abort();
      }
      await Promise.all(state.running);
    },
    cancelSessionJob: (jobId: string) => cancelSessionJob(state, jobId),
    confirmSessionJob: (jobId: string) => confirmSessionJob(state, jobId),
    selectTorrentFiles: (jobId: string, fileIds: string[]) =>
      selectTorrentFiles(state, jobId, fileIds),
    enqueueSessionJob: (job: SessionJob, confirmOversize: boolean) =>
      enqueueSessionJob(state, job, confirmOversize),
    getSchedulerState: () => ({
      activeCount: state.getActiveSessionJobCount(),
      maxConcurrent: state.maxConcurrent,
    }),
    getOrderedJobs: () =>
      state.jobOrder
        .map((id) => state.jobs.get(id)?.job)
        .filter((job) => job !== undefined),
    pauseSessionJob: (jobId: string) => pauseSessionJob(state, jobId),
    reorderSessionJobs: (jobIds: readonly string[]) =>
      reorderSessionJobs(state, jobIds),
    removeSessionJob: (jobId: string) => removeSessionJob(state, jobId),
    resumeSessionJob: (jobId: string) => resumeSessionJob(state, jobId),
    setMaxActiveSessionJobs: (value: number) =>
      setMaxActiveSessionJobs(state, value),
  };
}
