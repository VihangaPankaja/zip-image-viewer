import { TorrentReviewAction } from "./TorrentFileDialog";
import { Download } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import type { Job, TorrentPriority } from "../../../../../shared/contracts";
import {
  formatEta,
  formatSpeed,
  formatTransferBytes,
} from "../../../lib/formatterUtils";

type DownloadManagerProps = {
  jobs: readonly Job[];
  onCancel: (id: string) => void;
  onConfirm: (id: string) => Promise<void>;
  onOpenSession: (id: string) => void;
  onPause: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onSelectFiles: (id: string, fileIds: string[]) => Promise<void>;
  onFilePriority: (
    id: string,
    fileId: string,
    priority: TorrentPriority,
  ) => Promise<void>;
};

function moveJob(ids: string[], from: number, to: number): string[] {
  if (to < 0 || to >= ids.length || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

function downloadTitle(job: Job): string {
  const url = new URL(job.url);
  return job.url.startsWith("magnet:")
    ? url.searchParams.get("dn") || "Magnet download"
    : url.pathname.split("/").at(-1) || job.url;
}

type JobActionsProps = { job: Job } & Pick<
  DownloadManagerProps,
  | "onCancel"
  | "onConfirm"
  | "onOpenSession"
  | "onPause"
  | "onRemove"
  | "onResume"
  | "onRetry"
  | "onSelectFiles"
  | "onFilePriority"
>;

function JobActions({ job, ...actions }: JobActionsProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const confirm = async () => {
    setIsConfirming(true);
    setConfirmError("");
    try {
      await actions.onConfirm(job.id);
    } catch (error) {
      setConfirmError(
        error instanceof Error
          ? error.message
          : "Could not confirm this download.",
      );
    } finally {
      setIsConfirming(false);
    }
  };
  const terminal = ["ready", "cancelled", "error"].includes(job.status);
  return (
    <div className="download-row-actions">
      <TorrentReviewAction
        job={job}
        onSubmit={actions.onSelectFiles}
        onPriorityChange={actions.onFilePriority}
      />
      {job.status === "awaiting_confirmation" ? (
        <button
          type="button"
          disabled={isConfirming}
          onClick={() => void confirm()}
        >
          {isConfirming ? "Confirming…" : "Confirm & download"}
        </button>
      ) : null}
      {confirmError ? (
        <p className="download-confirm-error" role="alert">
          {confirmError}
        </p>
      ) : null}
      {job.status === "paused" ? (
        <button type="button" onClick={() => actions.onResume(job.id)}>
          Resume
        </button>
      ) : job.canPause ? (
        <button type="button" onClick={() => actions.onPause(job.id)}>
          Pause
        </button>
      ) : null}
      {job.status === "ready" ? (
        <button type="button" onClick={() => actions.onOpenSession(job.id)}>
          Open
        </button>
      ) : null}
      {job.status === "error" || job.status === "cancelled" ? (
        <button type="button" onClick={() => actions.onRetry(job.id)}>
          Retry
        </button>
      ) : null}
      <button
        type="button"
        onClick={() =>
          terminal
            ? (job.sourceKind !== "torrent" ||
                window.confirm(
                  "Delete this torrent download and all its downloaded files? This cannot be undone.",
                )) &&
              actions.onRemove(job.id)
            : actions.onCancel(job.id)
        }
      >
        {terminal
          ? job.sourceKind === "torrent"
            ? "Delete files"
            : "Remove"
          : "Cancel"}
      </button>
    </div>
  );
}

function DownloadTelemetry({ job }: { job: Job }) {
  return (
    <dl className="download-telemetry">
      <div>
        <dt>Transferred</dt>
        <dd>
          {formatTransferBytes(job.downloadedBytes)} /{" "}
          {job.reportedSize ? formatTransferBytes(job.reportedSize) : "—"}
        </dd>
      </div>
      <div>
        <dt>Speed</dt>
        <dd>{formatSpeed(job.downloadSpeedBytesPerSec)}</dd>
      </div>
      <div>
        <dt>ETA</dt>
        <dd>{job.etaSeconds == null ? "—" : formatEta(job.etaSeconds)}</dd>
      </div>
      <div>
        <dt>Retries</dt>
        <dd>
          {job.retryCount} / {job.maxRetries === -1 ? "∞" : job.maxRetries}
        </dd>
      </div>
      {job.sourceKind === "http" ? (
        <div>
          <dt>HTTP threads</dt>
          <dd>
            {job.threadMode} · {String(job.threadCount)}
          </dd>
        </div>
      ) : null}
      {job.sourceKind === "torrent" ? (
        <>
          <div>
            <dt>Peers</dt>
            <dd>{job.peerCount}</dd>
          </div>
          <div>
            <dt>Uploaded</dt>
            <dd>
              {formatTransferBytes(job.uploadedBytes)} ·{" "}
              {formatSpeed(job.uploadSpeedBytesPerSec)}
            </dd>
          </div>
        </>
      ) : null}
    </dl>
  );
}

function DownloadRow({
  job,
  index,
  jobCount,
  ids,
  onDrop,
  onDragStart,
  ...actions
}: {
  job: Job;
  index: number;
  jobCount: number;
  ids: string[];
  onDrop: (event: DragEvent<HTMLElement>, id: string) => void;
  onDragStart: (id: string) => void;
} & DownloadManagerProps) {
  return (
    <li
      className={`download-row status-${job.status}`}
      draggable
      onDragStart={() => onDragStart(job.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDrop(event, job.id)}
    >
      <div
        className="download-priority"
        aria-label={`Priority ${String(index + 1)}`}
      >
        <span>{String(index + 1).padStart(2, "0")}</span>
        <button
          type="button"
          aria-label="Move earlier"
          disabled={index === 0}
          onClick={() => actions.onReorder(moveJob(ids, index, index - 1))}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label="Move later"
          disabled={index === jobCount - 1}
          onClick={() => actions.onReorder(moveJob(ids, index, index + 1))}
        >
          ↓
        </button>
      </div>
      <div className="download-row-main">
        <div className="download-row-title">
          <strong title={job.url}>{downloadTitle(job)}</strong>
          <span
            role="status"
            aria-label={downloadTitle(job)}
            aria-atomic="true"
          >
            {job.status.replaceAll("_", " ")}
          </span>
        </div>
        <div className="download-progress-line">
          <progress
            aria-label={`${downloadTitle(job)} progress`}
            value={job.percent ?? 0}
            max="100"
          />
          <b>{job.percent == null ? "—" : `${Math.floor(job.percent)}%`}</b>
        </div>
        <DownloadTelemetry job={job} />
        <TorrentSelectionSummary job={job} />
        {job.message ? (
          <p className="download-status-message">{job.message}</p>
        ) : null}
        <code>{job.url}</code>
      </div>
      <JobActions job={job} {...actions} />
    </li>
  );
}

export function DownloadManager(props: DownloadManagerProps) {
  const jobs = useMemo(
    () => [...props.jobs].sort((a, b) => a.queuePosition - b.queuePosition),
    [props.jobs],
  );
  const ids = jobs.map(({ id }) => id);
  const [draggedId, setDraggedId] = useState("");
  const dropOn = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from >= 0 && to >= 0) props.onReorder(moveJob(ids, from, to));
    setDraggedId("");
  };
  return (
    <section className="download-manager" aria-labelledby="downloads-title">
      <header className="download-manager-header">
        <div>
          <p className="panel-label">Queue control</p>
          <h2 id="downloads-title" tabIndex={-1}>
            Downloads
          </h2>
          <p>
            {jobs.length
              ? "Drag downloads or use the arrows to change their priority."
              : "Add links, track progress, and explore your files."}
          </p>
        </div>
      </header>
      {jobs.length === 0 ? (
        <div className="download-empty">
          <span className="empty-state-icon">
            <Download size={28} aria-hidden="true" />
          </span>
          <strong>No transfers yet</strong>
          <p>Add direct download links or magnet URLs to start a transfer.</p>
        </div>
      ) : (
        <ol className="download-list">
          {jobs.map((job, index) => (
            <DownloadRow
              key={job.id}
              {...props}
              job={job}
              index={index}
              jobCount={jobs.length}
              ids={ids}
              onDrop={dropOn}
              onDragStart={setDraggedId}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function TorrentSelectionSummary({ job }: { job: Job }) {
  const selected = job.torrentFiles.filter((file) => file.selected);
  if (!selected.length) return null;
  const complete = selected.filter((file) => file.complete).length;
  return (
    <p className="torrent-selection-summary" role="status" aria-atomic="true">
      {selected.length} of {job.torrentFiles.length} files selected · {complete}{" "}
      complete
    </p>
  );
}
