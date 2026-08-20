import type { Job, SessionSummary } from "../../../../shared/contracts";
import type {
  JobPayload,
  SessionPayload,
} from "../../hooks/useSessionLifecycle";
import type { SessionRailItem } from "../../components/Workspace/SessionRail";

type ProgressLabels = {
  transfer: string;
  visualPercent: string;
};

export function buildWorkspaceRailItems(
  jobs: readonly Job[],
  sessions: readonly SessionSummary[],
  activeJob: JobPayload | null,
  activeSession: SessionPayload | null,
  labels: ProgressLabels,
): SessionRailItem[] {
  const items: SessionRailItem[] = jobs.map((job) => ({
    detail:
      job.percent == null
        ? job.phase
        : `${Math.floor(job.percent)}% · ${job.phase}`,
    id: job.id,
    label: job.url,
    state:
      job.status === "error"
        ? "error"
        : job.status === "ready"
          ? "ready"
          : "downloading",
  }));

  for (const session of sessions) {
    items.push({
      detail: `${session.fileCount} files`,
      id: session.id,
      label: session.firstFilePath || session.id,
      state: "ready",
    });
  }

  if (activeJob?.id && !items.some((item) => item.id === activeJob.id)) {
    items.push({
      detail: `${labels.visualPercent} · ${labels.transfer}`,
      id: activeJob.id,
      label: "Current download",
      state: "downloading",
    });
  }

  if (
    activeSession?.id &&
    !items.some((item) => item.id === activeSession.id)
  ) {
    items.push({
      detail: "Ready to browse",
      id: activeSession.id,
      label: activeSession.id,
      state: "ready",
    });
  }
  return items;
}
