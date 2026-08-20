import type { SessionJob } from "../domain/models.js";
type ProgressMessageInput = {
  currentBytes: number;
  reportedSize: number;
  isStalled: boolean;
  etaSeconds: number | null;
};
type ProgressState = {
  getDownloadedBytes: () => number;
  getReportedSize: () => number;
  phase: () => string;
  status: () => string;
  getMessage: (_input: ProgressMessageInput) => string;
};
type ProgressMonitorDependencies = {
  job: SessionJob;
  state: ProgressState;
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void;
  progressEmitIntervalMs: number;
  stallThresholdMs: number;
};

type ProgressMonitor = {
  start: () => void;
  flush: () => void;
  stop: () => void;
};

function getProgressSnapshot(
  currentBytes: number,
  reportedSize: number,
  averageSpeed: number,
): { percent: number | null; etaSeconds: number | null } {
  return {
    percent:
      reportedSize > 0
        ? Math.min(100, Math.floor((currentBytes / reportedSize) * 100))
        : null,
    etaSeconds:
      reportedSize > 0 && averageSpeed > 0
        ? Math.max(0, Math.ceil((reportedSize - currentBytes) / averageSpeed))
        : null,
  };
}

function updateAverageSpeed(previous: number, instant: number): number {
  if (instant <= 0) return Math.round(previous * 0.86);
  return previous <= 0 ? instant : Math.round(previous * 0.75 + instant * 0.25);
}

export function createDownloadProgressMonitor({
  job,
  state,
  emitJob,
  progressEmitIntervalMs,
  stallThresholdMs,
}: ProgressMonitorDependencies): ProgressMonitor {
  let timer: NodeJS.Timeout | null = null;
  let lastTickAt = Date.now();
  let lastTickBytes = state.getDownloadedBytes();
  let averageSpeed = 0;
  let noProgressSince = Date.now();

  function tick(force = false): void {
    const now = Date.now();
    const currentBytes = state.getDownloadedBytes();
    const reportedSize = state.getReportedSize();
    const elapsedMs = Math.max(1, now - lastTickAt);
    const deltaBytes = Math.max(0, currentBytes - lastTickBytes);

    if (!force && elapsedMs < progressEmitIntervalMs) {
      return;
    }

    const instantSpeed = Math.max(
      0,
      Math.round((deltaBytes * 1000) / elapsedMs),
    );

    if (deltaBytes > 0) {
      noProgressSince = now;
    }

    averageSpeed = updateAverageSpeed(averageSpeed, instantSpeed);

    const stallDurationMs = Math.max(0, now - noProgressSince);
    const isStalled =
      state.phase() === "downloading" &&
      state.status() === "downloading" &&
      stallDurationMs >= stallThresholdMs;
    const { percent, etaSeconds } = getProgressSnapshot(
      currentBytes,
      reportedSize,
      averageSpeed,
    );

    emitJob(job, {
      downloadedBytes: currentBytes,
      reportedSize,
      percent,
      downloadSpeedBytesPerSec: instantSpeed,
      averageSpeedBytesPerSec: Math.max(0, averageSpeed),
      etaSeconds,
      isStalled,
      stallDurationMs,
      message: state.getMessage({
        currentBytes,
        reportedSize,
        isStalled,
        etaSeconds,
      }),
    });

    lastTickAt = now;
    lastTickBytes = currentBytes;
  }

  return {
    start() {
      if (!timer) {
        timer = setInterval(() => {
          tick(false);
        }, progressEmitIntervalMs);
        timer.unref();
      }
    },
    flush() {
      tick(true);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
