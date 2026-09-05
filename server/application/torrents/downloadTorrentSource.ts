import { CONFIRM_SIZE_BYTES } from "../../config/runtimeConstants.js";
import type { SessionJob } from "../../domain/models.js";
import type { DownloadSettings } from "../downloads/downloadOptions.js";
import {
  fetchTorrentMetadata,
  type TorrentAdapter,
  type TorrentMetadata,
  type TorrentProgress,
} from "./torrentDownloader.js";

type EmitJob = (
  _job: SessionJob,
  _patch: Partial<SessionJob>,
  _event?: string,
) => void;

function confirmationError(): Error {
  return Object.assign(new Error("Torrent exceeds 1 GiB."), {
    code: "OVERSIZE_CONFIRM",
  });
}

function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

function handleMetadata(
  job: SessionJob,
  confirmOversize: boolean,
  emitJob: EmitJob,
  metadata: TorrentMetadata,
): void {
  if (metadata.length > CONFIRM_SIZE_BYTES && !confirmOversize) {
    throw confirmationError();
  }
  emitJob(job, {
    phase: "downloading",
    reportedSize: metadata.length,
    message: `Downloading ${metadata.name}`,
  });
}

function emitProgress(
  job: SessionJob,
  emitJob: EmitJob,
  progress: TorrentProgress,
): void {
  emitJob(job, {
    downloadedBytes: progress.downloadedBytes,
    verifiedBytes: progress.downloadedBytes,
    reportedSize: Math.max(job.reportedSize, progress.downloadedBytes),
    percent: Math.min(100, progress.progress * 100),
    peerCount: progress.peerCount,
    downloadSpeedBytesPerSec: progress.downloadSpeedBytesPerSec,
    uploadedBytes: progress.uploadedBytes,
    uploadSpeedBytesPerSec: progress.uploadSpeedBytesPerSec,
    isStalled: progress.peerCount === 0,
    message:
      progress.peerCount === 0
        ? "Torrent stalled: waiting for peers."
        : `Downloading from ${String(progress.peerCount)} peers`,
  });
}

export async function downloadTorrentSource(
  job: SessionJob,
  settings: DownloadSettings,
  input: {
    downloadDir: string;
    confirmOversize: boolean;
  },
  deps: { adapter: TorrentAdapter; emitJob: EmitJob },
): Promise<"complete" | "paused"> {
  const signal = job.abortController?.signal ?? AbortSignal.abort();
  Object.assign(job, {
    canPause: true,
    canResume: true,
    threadMode: "single",
    threadCount: 1,
  });
  deps.emitJob(job, {
    status: "downloading",
    phase: "resolving",
    message: "Resolving torrent metadata...",
  });
  const source = job.url.startsWith("magnet:")
    ? job.url
    : await fetchTorrentMetadata(job.url, signal);
  for (
    let attempt = 0;
    settings.maxRetries === -1 || attempt <= settings.maxRetries;
    attempt += 1
  ) {
    job.retryCount = attempt;
    try {
      await deps.adapter.download({
        source,
        downloadDir: input.downloadDir,
        signal,
        retainStoreOnAbort: () => job.pauseRequested,
        onMetadata: (metadata) =>
          handleMetadata(job, input.confirmOversize, deps.emitJob, metadata),
        onProgress: (progress) => emitProgress(job, deps.emitJob, progress),
        onNoPeers: () =>
          deps.emitJob(job, {
            isStalled: true,
            peerCount: 0,
            message: "Torrent stalled: no peers are available.",
          }),
      });
      deps.emitJob(job, {
        phase: "indexing",
        percent: 100,
        canPause: false,
        message: "Torrent complete. Indexing files...",
      });
      return "complete";
    } catch (error) {
      if (errorCode(error) === "OVERSIZE_CONFIRM") {
        deps.emitJob(job, {
          status: "awaiting_confirmation",
          phase: "confirm",
          requiresConfirmation: true,
          canPause: false,
          message: "Torrent is larger than 1 GiB and needs confirmation.",
        });
        return "paused";
      }
      if (
        error instanceof Error &&
        (error.name === "AbortError" ||
          (settings.maxRetries !== -1 && attempt >= settings.maxRetries))
      ) {
        throw error;
      }
    }
  }
  throw new Error("Torrent retries exhausted.");
}
