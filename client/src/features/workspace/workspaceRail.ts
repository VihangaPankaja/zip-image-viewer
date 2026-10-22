import type { Job, SessionSummary } from "../../../../shared/contracts";
import type { SessionRailItem } from "../../components/Workspace/SessionRail";
import { buildWorkspaceProgress } from "./workspaceProgress";
import { canContinueTorrentPlayback } from "./torrentPlaybackAvailability";

export type LivePreview = { jobId: string; fileId: string };

export function livePreviewFiles(job: Job) {
  return job.torrentFiles.filter(
    (file) => canContinueTorrentPlayback(job, file) && /\.(mp4|m4v)$/i.test(file.path),
  );
}

export function buildWorkspaceRailItems(
  jobs: readonly Job[],
  sessions: readonly SessionSummary[],
  livePreviews: readonly LivePreview[],
): SessionRailItem[] {
  const items = new Map<string, SessionRailItem>();
  const owners = new Map<string, string>();
  for (const session of sessions) {
    if (!session.fileCount) continue;
    if (session.jobId) owners.set(session.jobId, session.id);
    items.set(session.id, {
      detail: `${session.fileCount} files`,
      id: session.id,
      label: session.firstFilePath || session.id,
      state: "ready",
    });
  }
  for (const preview of livePreviews) {
    const job = jobs.find(({ id }) => id === preview.jobId);
    if (!job) continue;
    const file = livePreviewFiles(job).find(({ id }) => id === preview.fileId);
    const id = owners.get(job.id) || job.sessionId || job.id;
    if (!file || items.has(id)) continue;
    const progress = buildWorkspaceProgress({
      percent: job.percent,
      downloadedBytes: job.downloadedBytes,
      reportedSize: job.reportedSize,
      phase: job.phase,
    });
    items.set(id, {
      detail: `${progress.visualPercent} · ${progress.transfer}`,
      id,
      label: file.path,
      state: "downloading",
      livePreview: preview,
    });
  }
  return [...items.values()];
}
