import { formatTransferBytes } from "./formatterUtils";

type ArchiveJobLike = {
  message?: string;
  phase?: string;
  reportedSize?: number;
  isStalled?: boolean;
  downloadedBytes?: number;
  extractedEntries?: number;
  totalEntries?: number;
};

export function getImageCacheKey(
  sessionId: string,
  imagePath: string,
  quality: string,
): string {
  return `${sessionId}:${imagePath}:${quality}`;
}

export function getWrappedPath(
  items: string[],
  currentIndex: number,
  delta: number,
): string {
  if (!items.length || currentIndex === -1) {
    return "";
  }

  const nextIndex = (currentIndex + delta + items.length) % items.length;
  return items[nextIndex] || "";
}

export function formatProgressMessage(
  job: ArchiveJobLike | null | undefined,
): string {
  if (!job) {
    return "";
  }

  if (job.message) {
    return job.message;
  }

  const reportedSize = job.reportedSize ?? 0;
  const downloadedBytes = job.downloadedBytes ?? 0;

  if (job.phase === "downloading" && reportedSize > 0) {
    if (job.isStalled) {
      return "Download stalled, waiting for data or retry.";
    }
    return `Downloading archive: ${formatTransferBytes(downloadedBytes)} of ${formatTransferBytes(reportedSize)}`;
  }

  if (job.phase === "downloading") {
    return `Downloading archive: ${formatTransferBytes(downloadedBytes)} received`;
  }

  if (job.phase === "extracting") {
    return `Extracting archive: ${job.extractedEntries || 0} of ${job.totalEntries || 0} entries`;
  }

  return "Working on archive...";
}

export function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isTerminalJobStatus(status: string): boolean {
  return status === "ready" || status === "error" || status === "cancelled";
}
