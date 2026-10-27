import { lstat } from "node:fs/promises";
import {
  hashDownloadFile,
  rangeValidator,
  type HttpCheckpoint,
} from "../../infrastructure/downloads/httpCheckpoint.js";
import { CONFIRM_SIZE_BYTES, PROGRESS_EMIT_INTERVAL_MS } from "../../config/runtimeConstants.js";
import type { SessionJob } from "../../domain/models.js";
import type { DownloadSettings } from "../downloads/downloadOptions.js";
import { createDownloadProgressMonitor } from "../../services/jobProgressMonitor.js";
import {
  fetchRemoteMetadata,
  type RemoteMetadata,
} from "../../infrastructure/downloads/remoteMetadata.js";
import { formatBytes } from "../../infrastructure/runtime/runtimePrimitives.js";
import { sleepWithSignal } from "../../infrastructure/runtime/mediaClassification.js";
import { downloadErrorCode, retryDelay } from "../../infrastructure/downloads/httpRetry.js";

const STALL_THRESHOLD_MS = 4_000;
export type DownloadState = {
  downloadedBytes: number;
  reportedSize: number;
  statusText: string;
};
type EmitJob = (_job: SessionJob, _patch: Partial<SessionJob>, _event?: string) => void;
export type DownloadSourceDependencies = {
  emitJob: EmitJob;
  closeJob: (_job: SessionJob, _status: SessionJob["status"]) => void;
  download: (_input: {
    url: string;
    targetPath: string;
    signal: AbortSignal;
    settings: DownloadSettings;
    state: DownloadState;
    metadata: RemoteMetadata;
    confirmOversize: boolean;
    checkpoint?: HttpCheckpoint;
  }) => Promise<void>;
};

function createMonitor(job: SessionJob, state: DownloadState, emitJob: EmitJob) {
  return createDownloadProgressMonitor({
    job,
    emitJob,
    progressEmitIntervalMs: PROGRESS_EMIT_INTERVAL_MS,
    stallThresholdMs: STALL_THRESHOLD_MS,
    state: {
      getDownloadedBytes: () => state.downloadedBytes,
      getReportedSize: () => state.reportedSize,
      phase: () => job.phase,
      status: () => job.status,
      getMessage: ({ currentBytes, reportedSize, isStalled }) => {
        if (state.statusText) return state.statusText;
        if (isStalled) return "Download appears stalled. Waiting for more data...";
        return reportedSize > 0
          ? `Downloading archive: ${formatBytes(currentBytes)} of ${formatBytes(reportedSize)}`
          : `Downloading archive: ${formatBytes(currentBytes)} received`;
      },
    },
  });
}

function pauseForConfirmation(
  job: SessionJob,
  size: number,
  deps: DownloadSourceDependencies,
): void {
  deps.emitJob(
    job,
    {
      status: "awaiting_confirmation",
      phase: "confirm",
      requiresConfirmation: true,
      reportedSize: size,
      downloadedBytes: size,
      percent: null,
      downloadSpeedBytesPerSec: 0,
      averageSpeedBytesPerSec: 0,
      etaSeconds: null,
      message: `Archive is ${formatBytes(size)} and needs confirmation before download.`,
    },
    "confirmation",
  );
  deps.closeJob(job, "awaiting_confirmation");
}

async function retryDownload(
  job: SessionJob,
  settings: DownloadSettings,
  state: DownloadState,
  metadata: RemoteMetadata,
  input: { url: string; zipPath: string; confirmOversize: boolean },
  deps: DownloadSourceDependencies,
): Promise<"complete" | "paused"> {
  const budget = { retries: 0, waitedMs: 0 };
  for (;;) {
    job.retryCount = budget.retries;
    try {
      state.statusText = "";
      await deps.download({
        url: input.url,
        targetPath: input.zipPath,
        signal: job.abortController?.signal ?? AbortSignal.abort(),
        // This job owns the retry budget; segment retries must not multiply it.
        settings: { ...settings, maxRetries: 0 },
        state,
        metadata,
        confirmOversize: input.confirmOversize,
        checkpoint: {
          current: job.httpDownload,
          save: (httpDownload) => {
            const canResume =
              settings.enableResume && metadata.acceptRanges && Boolean(rangeValidator(metadata));
            deps.emitJob(job, {
              httpDownload,
              threadMode: httpDownload.files.length > 1 ? "segmented" : "single",
              threadCount: httpDownload.files.length,
              canResume,
              canPause: canResume,
            });
            if (job.status === "error" && job.abortController?.signal.aborted)
              job.abortController.signal.throwIfAborted();
          },
        },
      });
      return "complete";
    } catch (error) {
      if (downloadErrorCode(error) === "OVERSIZE_CONFIRM") return "paused";
      const delay = retryDelay(error, settings.maxRetries, budget);
      if (delay === undefined) throw error;
      state.statusText = `Download failed, retrying in ${(delay / 1_000).toFixed(1)}s`;
      await sleepWithSignal(delay, job.abortController?.signal ?? AbortSignal.abort());
      Object.assign(
        metadata,
        await fetchRemoteMetadata(input.url, job.abortController?.signal ?? AbortSignal.abort()),
      );
      if (metadata.size > CONFIRM_SIZE_BYTES && !input.confirmOversize) {
        state.downloadedBytes = metadata.size;
        return "paused";
      }
    }
  }
}

async function reuseVerifiedSource(
  job: SessionJob,
  input: { zipPath: string; confirmOversize: boolean },
  deps: DownloadSourceDependencies,
): Promise<"complete" | "paused" | null> {
  if (!job.httpDownload?.completedSha256) return null;
  const source = await lstat(input.zipPath).catch(() => null);
  if (
    !source?.isFile() ||
    (await hashDownloadFile(input.zipPath)) !== job.httpDownload.completedSha256
  ) {
    deps.emitJob(job, { httpDownload: undefined });
    return null;
  }
  if (source.size > CONFIRM_SIZE_BYTES && !input.confirmOversize) {
    pauseForConfirmation(job, source.size, deps);
    return "paused";
  }
  deps.emitJob(job, { downloadedBytes: source.size, reportedSize: source.size, percent: 100 });
  return "complete";
}

export async function downloadSessionSource(
  job: SessionJob,
  settings: DownloadSettings,
  input: {
    url: string;
    zipPath: string;
    workspaceDir: string;
    confirmOversize: boolean;
  },
  deps: DownloadSourceDependencies,
): Promise<"complete" | "paused"> {
  const reused = await reuseVerifiedSource(job, input, deps);
  if (reused) return reused;
  const state: DownloadState = {
    downloadedBytes: 0,
    reportedSize: 0,
    statusText: "Starting archive download",
  };
  const monitor = createMonitor(job, state, deps.emitJob);
  deps.emitJob(job, {
    status: "downloading",
    phase: "downloading",
    message: state.statusText,
    error: "",
  });
  const signal = job.abortController?.signal ?? AbortSignal.abort();
  job.maxRetries = settings.maxRetries === -1 ? 8 : settings.maxRetries;
  const metadata = await fetchRemoteMetadata(input.url, signal);
  state.reportedSize = metadata.size;
  if (metadata.size > CONFIRM_SIZE_BYTES && !input.confirmOversize) {
    deps.emitJob(job, {
      httpDownload: job.httpDownload ?? {
        originalUrl: input.url,
        resolvedUrl: metadata.resolvedUrl || input.url,
        size: metadata.size,
        validator: rangeValidator(metadata),
        completedSha256: "",
        files: [{ index: -1, start: 0, end: metadata.size - 1, bytes: 0, sha256: "" }],
      },
    });
    pauseForConfirmation(job, metadata.size, deps);
    return "paused";
  }
  job.threadMode =
    settings.threadMode === "auto"
      ? settings.enableMultithread && metadata.acceptRanges && Boolean(rangeValidator(metadata))
        ? "segmented"
        : "single"
      : settings.threadMode;
  job.threadCount = job.threadMode === "segmented" ? settings.threadCount : 1;
  job.canResume =
    settings.enableResume && metadata.acceptRanges && Boolean(rangeValidator(metadata));
  job.canPause = job.canResume;
  monitor.start();
  try {
    const result = await retryDownload(job, settings, state, metadata, input, deps);
    if (result === "paused") {
      pauseForConfirmation(job, state.downloadedBytes, deps);
      return result;
    }
    state.reportedSize = metadata.size || state.downloadedBytes;
    monitor.flush();
    deps.emitJob(job, {
      downloadedBytes: state.downloadedBytes,
      reportedSize: state.reportedSize,
      percent: 100,
      message: "Archive download complete. Preparing extraction...",
    });
    return result;
  } finally {
    monitor.stop();
  }
}
