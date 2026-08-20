import type { JobPayload } from "./sessionSchemas";
import { formatTransferBytes } from "../../lib/formatterUtils";

export type WorkspaceProgress = {
  transfer: string;
  visualPercent: string;
};

export function buildWorkspaceProgress(
  activeJob: JobPayload | null,
): WorkspaceProgress {
  const downloadedBytes = Math.max(0, Number(activeJob?.downloadedBytes) || 0);
  const completed = Math.max(0, Number(activeJob?.transcodedEntries) || 0);
  const total = Math.max(0, Number(activeJob?.totalTranscodeEntries) || 0);
  const derivedPercent = total > 0 ? (completed / total) * 100 : null;
  const percent =
    activeJob?.phase === "transcoding" && activeJob.percent == null
      ? derivedPercent
      : activeJob?.percent;

  return {
    transfer: buildTransferLabel(activeJob, downloadedBytes, completed, total),
    visualPercent:
      percent == null
        ? "Live"
        : `${Math.max(0, Math.min(100, Math.floor(percent)))}%`,
  };
}

function buildTransferLabel(
  activeJob: JobPayload | null,
  downloadedBytes: number,
  completed: number,
  total: number,
): string {
  if (activeJob?.phase === "transcoding") {
    return `${completed} / ${Math.max(1, total)} files`;
  }
  if ((activeJob?.reportedSize ?? 0) > 0) {
    return `${formatTransferBytes(downloadedBytes)} / ${formatTransferBytes(activeJob?.reportedSize ?? 0)}`;
  }
  return `${formatTransferBytes(downloadedBytes)} downloaded`;
}
