import { useMemo, useState, type DragEvent } from "react";
import type { Job } from "../../../../../shared/contracts";
import {
  formatEta,
  formatSpeed,
  formatTransferBytes,
} from "../../../lib/formatterUtils";

type DownloadManagerProps = {
  jobs: readonly Job[];
  maxConcurrent: number;
  onCancel: (id: string) => void;
  onOpenSession: (id: string) => void;
  onPause: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onSetConcurrency: (value: number) => void;
};

function moveJob(ids: string[], from: number, to: number): string[] {
  if (to < 0 || to >= ids.length || from === to) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

function JobActions({
  job,
  ...actions
}: { job: Job } & Pick<
  DownloadManagerProps,
  "onCancel" | "onOpenSession" | "onPause" | "onRemove" | "onResume" | "onRetry"
>) {
  const terminal = ["ready", "cancelled", "error"].includes(job.status);
  return (
    <div className="download-row-actions">
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
          terminal ? actions.onRemove(job.id) : actions.onCancel(job.id)
        }
      >
        {terminal ? "Remove" : "Cancel"}
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
      <div>
        <dt>Threads</dt>
        <dd>
          {job.sourceKind === "torrent"
            ? "Torrent"
            : `${job.threadMode} · ${String(job.threadCount)}`}
        </dd>
      </div>
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
          <strong title={job.url}>
            {new URL(job.url).pathname.split("/").at(-1) || job.url}
          </strong>
          <span>{job.status.replaceAll("_", " ")}</span>
        </div>
        <div className="download-progress-line">
          <progress value={job.percent ?? 0} max="100" />
          <b>{job.percent == null ? "—" : `${Math.floor(job.percent)}%`}</b>
        </div>
        <DownloadTelemetry job={job} />
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
          <h2 id="downloads-title">Downloads</h2>
          <p>
            Priority is read top to bottom. Active resumable work yields when
            promoted work needs a slot.
          </p>
        </div>
        <label className="concurrency-control">
          <span>Concurrent</span>
          <input
            type="number"
            min="1"
            max="8"
            value={props.maxConcurrent}
            onChange={(event) =>
              props.onSetConcurrency(Number(event.currentTarget.value))
            }
          />
        </label>
      </header>
      {jobs.length === 0 ? (
        <div className="download-empty">
          <strong>No transfers yet</strong>
          <p>
            Add direct links now. Torrent sources become available in the next
            stack layer.
          </p>
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
