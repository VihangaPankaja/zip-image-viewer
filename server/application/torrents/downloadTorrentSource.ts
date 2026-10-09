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
): string[] {
  const selected = job.torrentFiles.filter((file) => file.selected);
  if (metadata.torrentFile) job.torrentMetadata = metadata.torrentFile;
  if (!selected.length) {
    emitJob(job, {
      torrentFiles: metadata.files,
      reportedSize: metadata.length,
    });
    throw Object.assign(new Error("Choose torrent files to download."), {
      code: "FILE_SELECTION",
    });
  }
  if (
    selected.some(
      (file) =>
        !metadata.files.some(
          (resolved) =>
            resolved.id === file.id &&
            resolved.path === file.path &&
            resolved.size === file.size,
        ),
    )
  ) {
    throw new Error(
      "Torrent metadata changed. Add the torrent again to review its files.",
    );
  }
  const size = selected.reduce((sum, file) => sum + file.size, 0);
  if (size > CONFIRM_SIZE_BYTES && !confirmOversize) throw confirmationError();
  emitJob(job, {
    phase: "downloading",
    reportedSize: size,
    requiresConfirmation: false,
    message: `Downloading ${metadata.name}`,
  });
  return selected.map((file) => file.id);
}

function emitProgress(
  job: SessionJob,
  emitJob: EmitJob,
  progress: TorrentProgress,
): void {
  emitJob(job, {
    ...(progress.files ? { torrentFiles: progress.files } : {}),
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
        ? "No peers connected. Download resumes when peers become available."
        : `Downloading from ${String(progress.peerCount)} peers`,
  });
}

function waitForUser(
  job: SessionJob,
  error: unknown,
  emitJob: EmitJob,
): boolean {
  if (errorCode(error) === "FILE_SELECTION") {
    emitJob(job, {
      status: "awaiting_selection",
      phase: "selecting",
      canPause: false,
      canResume: false,
      downloadSpeedBytesPerSec: 0,
      percent: 0,
      message: "Choose files to download.",
    });
    return true;
  }
  if (errorCode(error) === "OVERSIZE_CONFIRM") {
    emitJob(job, {
      status: "awaiting_confirmation",
      phase: "confirm",
      requiresConfirmation: true,
      canPause: false,
      message: "Torrent is larger than 1 GiB and needs confirmation.",
    });
    return true;
  }
  return false;
}

function monitorProgress(job: SessionJob, emitJob: EmitJob) {
  let lastProgressBytes = job.downloadedBytes;
  let lastProgressAt = Date.now();
  return (progress: TorrentProgress) => {
    if (
      progress.downloadedBytes > lastProgressBytes ||
      progress.downloadSpeedBytesPerSec > 0
    ) {
      lastProgressBytes = progress.downloadedBytes;
      lastProgressAt = Date.now();
    }
    emitProgress(job, emitJob, progress);
    if (progress.peerCount > 0 && Date.now() - lastProgressAt > 15_000)
      emitJob(job, {
        isStalled: true,
        message:
          "No data received for 15 seconds. Connected peers may not have the selected pieces. Waiting for availability.",
      });
  };
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
  const source =
    job.torrentMetadata ??
    (job.url.startsWith("magnet:")
      ? job.url
      : await fetchTorrentMetadata(job.url, signal));
  for (
    let attempt = 0;
    settings.maxRetries === -1 || attempt <= settings.maxRetries;
    attempt += 1
  ) {
    job.retryCount = attempt;
    try {
      await deps.adapter.download({
        jobId: job.id,
        priorities: Object.fromEntries(
          job.torrentFiles.map(({ id, priority }) => [
            id,
            priority ?? "normal",
          ]),
        ),
        source,
        peerHints: job.url.startsWith("magnet:")
          ? new URL(job.url).searchParams.getAll("x.pe")
          : [],
        downloadDir: input.downloadDir,
        signal,
        retainStoreOnAbort: () => true,
        onMetadata: (metadata) =>
          handleMetadata(job, input.confirmOversize, deps.emitJob, metadata),
        onProgress: monitorProgress(job, deps.emitJob),
        onNoPeers: () =>
          deps.emitJob(job, {
            isStalled: true,
            peerCount: 0,
            message:
              "No peers connected. Download resumes when peers become available.",
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
      if (waitForUser(job, error, deps.emitJob)) return "paused";
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
