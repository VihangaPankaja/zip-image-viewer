import { rm } from "node:fs/promises";
import {
  CONFIRM_SIZE_BYTES,
  PROGRESS_EMIT_INTERVAL_MS,
} from "../../config/runtimeConstants.js";
import type { SessionJob } from "../../domain/models.js";
import type { DownloadSettings } from "../downloads/downloadOptions.js";
import { createDownloadProgressMonitor } from "../../services/jobProgressMonitor.js";
import {
  fetchRemoteMetadata,
  type RemoteMetadata,
} from "../../infrastructure/downloads/remoteMetadata.js";
import { formatBytes } from "../../infrastructure/runtime/runtimePrimitives.js";
import {
  isRecord,
  sleepWithSignal,
} from "../../infrastructure/runtime/mediaClassification.js";

const UNLIMITED_RETRIES = -1;
const RETRY_BASE_DELAY_MS = 1_200;
const STALL_THRESHOLD_MS = 4_000;
export type DownloadState = {
  downloadedBytes: number;
  reportedSize: number;
  statusText: string;
};
type EmitJob = (
  _job: SessionJob,
  _patch: Partial<SessionJob>,
  _event?: string,
) => void;
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
  }) => Promise<void>;
};

function createMonitor(
  job: SessionJob,
  state: DownloadState,
  emitJob: EmitJob,
) {
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
        if (isStalled)
          return "Download appears stalled. Waiting for more data...";
        return reportedSize > 0
          ? `Downloading archive: ${formatBytes(currentBytes)} of ${formatBytes(reportedSize)}`
          : `Downloading archive: ${formatBytes(currentBytes)} received`;
      },
    },
  });
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return false;
  const code = errorCode(error);
  if (code === "OVERSIZE_CONFIRM" || code === "DOWNLOAD_FATAL") return false;
  const status =
    isRecord(error) && typeof error.statusCode === "number"
      ? error.statusCode
      : 0;
  return status ? status >= 500 || status === 408 || status === 429 : true;
}

async function pauseForConfirmation(
  job: SessionJob,
  workspaceDir: string,
  size: number,
  deps: DownloadSourceDependencies,
): Promise<void> {
  await rm(workspaceDir, { recursive: true, force: true });
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
  for (
    let attempt = 0;
    settings.maxRetries === UNLIMITED_RETRIES || attempt <= settings.maxRetries;
    attempt += 1
  ) {
    job.retryCount = attempt;
    const retries =
      settings.maxRetries === UNLIMITED_RETRIES
        ? "∞"
        : String(settings.maxRetries);
    state.statusText =
      attempt === 0
        ? "Starting archive download"
        : `Retrying download (attempt ${String(attempt)}/${retries})`;
    try {
      state.statusText = "";
      await deps.download({
        url: input.url,
        targetPath: input.zipPath,
        signal: job.abortController?.signal ?? AbortSignal.abort(),
        settings,
        state,
        metadata,
        confirmOversize: input.confirmOversize,
      });
      return "complete";
    } catch (error) {
      if (errorCode(error) === "OVERSIZE_CONFIRM") return "paused";
      if (
        (settings.maxRetries !== UNLIMITED_RETRIES &&
          attempt >= settings.maxRetries) ||
        !isRetryable(error)
      )
        throw error;
      const delay =
        RETRY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 400);
      state.statusText = `Download failed, retrying in ${(delay / 1_000).toFixed(1)}s`;
      await sleepWithSignal(
        delay,
        job.abortController?.signal ?? AbortSignal.abort(),
      );
    }
  }
  throw new Error("Download retries exhausted.");
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
  const metadata = await fetchRemoteMetadata(input.url, signal);
  state.reportedSize = metadata.size;
  if (metadata.size > CONFIRM_SIZE_BYTES && !input.confirmOversize) {
    await pauseForConfirmation(job, input.workspaceDir, metadata.size, deps);
    return "paused";
  }
  job.threadMode =
    settings.threadMode === "auto"
      ? settings.enableMultithread && metadata.acceptRanges
        ? "segmented"
        : "single"
      : settings.threadMode;
  job.threadCount = job.threadMode === "segmented" ? settings.threadCount : 1;
  job.canResume = settings.enableResume && metadata.acceptRanges;
  job.canPause = job.canResume;
  monitor.start();
  try {
    const result = await retryDownload(
      job,
      settings,
      state,
      metadata,
      input,
      deps,
    );
    if (result === "paused") {
      await pauseForConfirmation(
        job,
        input.workspaceDir,
        state.downloadedBytes,
        deps,
      );
      return result;
    }
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
