import type { WorkspacePageController } from "../useWorkspacePageController";
import { TorrentEarlyVideo } from "./TorrentEarlyVideo";

export function WorkspacePreviewRecovery({
  message,
  controller,
  readySessionId,
}: {
  message: string;
  controller: WorkspacePageController;
  readySessionId?: string;
}) {
  return (
    <div className="empty-card">
      <strong role="status">{message}</strong>
      <p>Manage the transfer in Downloads, or choose another available session.</p>
      {readySessionId ? (
        <button
          className="primary-button"
          type="button"
          onClick={() => void controller.actions.openSession(readySessionId)}
        >
          Open ready files
        </button>
      ) : null}
      <button
        className="ghost-button"
        type="button"
        onClick={() => controller.state.setActiveView("downloads")}
      >
        View downloads
      </button>
    </div>
  );
}

export function WorkspaceLivePreview({ controller }: { controller: WorkspacePageController }) {
  const selected = controller.actions.livePreview;
  const job = controller.queue.jobs.find(({ id }) => id === selected?.jobId);
  const file = job?.torrentFiles.find(({ id }) => id === selected?.fileId);
  const available = controller.railItems.some(
    (item) => item.livePreview?.jobId === job?.id && item.livePreview?.fileId === file?.id,
  );
  if (!available || !job || !file) {
    const readySessionId = controller.queue.sessions.find(
      (session) =>
        session.fileCount > 0 &&
        (session.id === job?.sessionId || session.jobId === selected?.jobId),
    )?.id;
    return (
      <WorkspacePreviewRecovery
        controller={controller}
        readySessionId={readySessionId}
        message={
          readySessionId
            ? "Download complete. Your files are ready."
            : "This live preview is no longer available."
        }
      />
    );
  }
  return (
    <TorrentEarlyVideo
      key={`${job.id}:${file.id}`}
      job={job}
      file={file}
      backLabel="Back to downloads"
      onBack={controller.actions.closeLivePreview}
    />
  );
}
