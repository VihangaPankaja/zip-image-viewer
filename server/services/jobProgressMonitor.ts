// @ts-nocheck

export function createDownloadProgressMonitor({
  job,
  state,
  emitJob,
  progressEmitIntervalMs,
  stallThresholdMs,
}) {
  let timer = null;
  let lastTickAt = Date.now();
  let lastTickBytes = state.getDownloadedBytes();
  let averageSpeed = 0;
  let noProgressSince = Date.now();

  function tick(force = false) {
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

    if (instantSpeed > 0) {
      averageSpeed =
        averageSpeed <= 0
          ? instantSpeed
          : Math.round(averageSpeed * 0.75 + instantSpeed * 0.25);
    } else {
      averageSpeed = Math.round(averageSpeed * 0.86);
    }

    const stallDurationMs = Math.max(0, now - noProgressSince);
    const isStalled =
      state.phase() === "downloading" &&
      state.status() === "downloading" &&
      stallDurationMs >= stallThresholdMs;
    const percent =
      reportedSize > 0
        ? Math.min(100, Math.floor((currentBytes / reportedSize) * 100))
        : null;
    const etaSeconds =
      reportedSize > 0 && averageSpeed > 0
        ? Math.max(0, Math.ceil((reportedSize - currentBytes) / averageSpeed))
        : null;

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
        timer = setInterval(() => tick(false), progressEmitIntervalMs);
        timer.unref?.();
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
