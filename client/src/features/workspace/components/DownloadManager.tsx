import { useMemo, useRef, useState, type DragEvent } from "react";
import type { Job } from "../../../../../shared/contracts";
import type { DownloadOptions } from "../../../types/download";
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
      {!terminal ? (
        <button type="button" onClick={() => actions.onCancel(job.id)}>
          Cancel
        </button>
      ) : (
        <button type="button" onClick={() => actions.onRemove(job.id)}>
          Remove
        </button>
      )}
    </div>
  );
}

export function DownloadManager(props: DownloadManagerProps) {
  const jobs = useMemo(
    () => [...props.jobs].sort((a, b) => a.queuePosition - b.queuePosition),
    [props.jobs],
  );
  const ids = jobs.map(({ id }) => id);
  const [draggedId, setDraggedId] = useState("");
  function dropOn(event: DragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from >= 0 && to >= 0) props.onReorder(moveJob(ids, from, to));
    setDraggedId("");
  }
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
            <li
              key={job.id}
              className={`download-row status-${job.status}`}
              draggable
              onDragStart={() => setDraggedId(job.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropOn(event, job.id)}
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
                  onClick={() =>
                    props.onReorder(moveJob(ids, index, index - 1))
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Move later"
                  disabled={index === jobs.length - 1}
                  onClick={() =>
                    props.onReorder(moveJob(ids, index, index + 1))
                  }
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
                  <b>
                    {job.percent == null ? "—" : `${Math.floor(job.percent)}%`}
                  </b>
                </div>
                <dl className="download-telemetry">
                  <div>
                    <dt>Transferred</dt>
                    <dd>
                      {formatTransferBytes(job.downloadedBytes)} /{" "}
                      {job.reportedSize
                        ? formatTransferBytes(job.reportedSize)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Speed</dt>
                    <dd>{formatSpeed(job.downloadSpeedBytesPerSec)}</dd>
                  </div>
                  <div>
                    <dt>ETA</dt>
                    <dd>
                      {job.etaSeconds == null ? "—" : formatEta(job.etaSeconds)}
                    </dd>
                  </div>
                  <div>
                    <dt>Retries</dt>
                    <dd>
                      {job.retryCount} /{" "}
                      {job.maxRetries === -1 ? "∞" : job.maxRetries}
                    </dd>
                  </div>
                  <div>
                    <dt>Threads</dt>
                    <dd>
                      {job.threadMode} · {job.threadCount}
                    </dd>
                  </div>
                </dl>
                <code>{job.url}</code>
              </div>
              <JobActions job={job} {...props} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type DownloadItem = { url: string; downloadOptions: DownloadOptions };
type DownloadDraft = DownloadItem & { id: string };
type DownloadDialogProps = {
  defaultOptions: DownloadOptions;
  open: boolean;
  onClose: () => void;
  onSubmit: (items: DownloadItem[]) => void;
};

function parseDrafts(
  value: string,
  options: DownloadOptions,
  startId: number,
): DownloadDraft[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((url, index) => ({
      id: `download-${String(startId + index)}`,
      url,
      downloadOptions: structuredClone(options),
    }));
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function DownloadDialog({
  defaultOptions,
  open,
  onClose,
  onSubmit,
}: DownloadDialogProps) {
  const [source, setSource] = useState("");
  const [drafts, setDrafts] = useState<DownloadDraft[]>([]);
  const nextDraftId = useRef(0);
  if (!open) return null;
  const urlCounts = new Map<string, number>();
  drafts.forEach(({ url }) =>
    urlCounts.set(url, (urlCounts.get(url) ?? 0) + 1),
  );
  const invalidCount = drafts.filter(({ url }) => !validHttpUrl(url)).length;
  const duplicateCount = drafts.filter(
    ({ url }) => (urlCounts.get(url) ?? 0) > 1,
  ).length;
  return (
    <dialog
      ref={(dialog) => {
        if (dialog && !dialog.open) dialog.showModal();
      }}
      className="download-dialog"
      aria-labelledby="download-dialog-title"
      onClose={onClose}
    >
      <form
        className="download-dialog-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalidCount && !duplicateCount && drafts.length)
            onSubmit(
              drafts.map(({ url, downloadOptions }) => ({
                url,
                downloadOptions,
              })),
            );
        }}
      >
        <header>
          <div>
            <p className="panel-label">New transfer batch</p>
            <h2 id="download-dialog-title">Add downloads</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="download-compose">
          <label>
            <span>Paste download URLs</span>
            <textarea
              value={source}
              rows={6}
              placeholder="One public URL per line"
              onChange={(event) => setSource(event.currentTarget.value)}
            />
          </label>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              const available = Math.max(0, 50 - drafts.length);
              const added = parseDrafts(
                source,
                defaultOptions,
                nextDraftId.current,
              ).slice(0, available);
              nextDraftId.current += added.length;
              setDrafts((current) => [...current, ...added]);
              setSource("");
            }}
          >
            Review links
          </button>
        </div>
        <div className="download-drafts" aria-live="polite">
          {drafts.map((draft, index) => (
            <article
              className={
                validHttpUrl(draft.url) && (urlCounts.get(draft.url) ?? 0) === 1
                  ? "download-draft"
                  : "download-draft invalid"
              }
              key={draft.id}
            >
              <span className="draft-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <label>
                <span>Download URL</span>
                <input
                  value={draft.url}
                  aria-invalid={
                    !validHttpUrl(draft.url) ||
                    (urlCounts.get(draft.url) ?? 0) > 1
                  }
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((item) =>
                        item.id === draft.id
                          ? { ...item, url: event.currentTarget.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <details>
                <summary>Per-download settings</summary>
                <div className="draft-settings">
                  <label>
                    <span>Threads</span>
                    <input
                      type="number"
                      min="1"
                      max="8"
                      value={draft.downloadOptions.transport.threads}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id
                              ? {
                                  ...item,
                                  downloadOptions: {
                                    ...item.downloadOptions,
                                    transport: {
                                      ...item.downloadOptions.transport,
                                      threads: Number(
                                        event.currentTarget.value,
                                      ),
                                    },
                                  },
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Retries</span>
                    <input
                      type="number"
                      min="0"
                      max="8"
                      value={draft.downloadOptions.retry.maxRetries}
                      onChange={(event) =>
                        setDrafts((current) =>
                          current.map((item) =>
                            item.id === draft.id
                              ? {
                                  ...item,
                                  downloadOptions: {
                                    ...item.downloadOptions,
                                    retry: {
                                      ...item.downloadOptions.retry,
                                      maxRetries: Number(
                                        event.currentTarget.value,
                                      ),
                                    },
                                  },
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              </details>
              <button
                type="button"
                className="ghost-button"
                aria-label={`Remove ${draft.url}`}
                onClick={() =>
                  setDrafts((current) =>
                    current.filter(({ id }) => id !== draft.id),
                  )
                }
              >
                Remove
              </button>
            </article>
          ))}
        </div>
        <footer>
          <span>
            {drafts.length} of 50 ready
            {invalidCount ? ` · ${invalidCount} invalid` : ""}
            {duplicateCount ? ` · ${duplicateCount} duplicates` : ""}
          </span>
          <button
            className="primary-button"
            type="submit"
            disabled={!drafts.length || invalidCount > 0 || duplicateCount > 0}
          >
            Add {drafts.length} downloads
          </button>
        </footer>
      </form>
    </dialog>
  );
}
