import { useMemo, useState, type KeyboardEvent } from "react";
import type { Job, TorrentPriority } from "../../../../../shared/contracts";
import { formatTransferBytes } from "../../../lib/formatterUtils";
import { classifyExtension } from "../../../lib/mimeTypeSystem";
import { FileTools, fileState } from "./TorrentFileContents";
import { FileList } from "./TorrentFileList";
import { useModalDialog } from "../../../hooks/useModalDialog";

type TorrentFile = Job["torrentFiles"][number];
type Props = {
  job: Job;
  onClose: () => void;
  onSubmit: (id: string, fileIds: string[]) => Promise<void>;
  onPriorityChange?: (
    id: string,
    fileId: string,
    priority: TorrentPriority,
  ) => Promise<void>;
};

function filterFiles(
  job: Job,
  selecting: boolean,
  search: string,
  mediaType: string,
  status: string,
) {
  return job.torrentFiles.filter((file) => {
    const { path } = file;
    const filename = path.split("/").at(-1) ?? "";
    const dot = filename.lastIndexOf(".");
    const extension = dot > 0 ? filename.slice(dot + 1) : "";
    return (
      path.toLowerCase().includes(search.toLowerCase()) &&
      (selecting || status === "all" || fileState(file, job) === status) &&
      (mediaType === "all" || classifyExtension(extension) === mediaType)
    );
  });
}

function filePriorityAction(
  job: Job,
  onPriorityChange: Props["onPriorityChange"],
  setError: (_error: string) => void,
) {
  return async (fileId: string, priority: TorrentPriority) => {
    if (!onPriorityChange) return;
    setError("");
    try {
      await onPriorityChange(job.id, fileId, priority);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not change file priority.",
      );
    }
  };
}

function useTorrentSelection({
  job,
  onClose,
  onSubmit,
  onPriorityChange,
}: Props) {
  const { adding, setAdding, displayJob, selected, setSelected } =
    useTorrentChoices(job);
  const selecting = job.status === "awaiting_selection" || adding;
  const dialogRef = useModalDialog();
  const [search, setSearch] = useState("");
  const [mediaType, setMediaType] = useState("all");
  const [status, setStatus] = useState("all");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const chosen = useMemo(
    () =>
      displayJob.torrentFiles.filter((file) =>
        selecting ? selected.has(file.id) : file.selected,
      ),
    [displayJob.torrentFiles, selecting, selected],
  );
  const visible = useMemo(
    () => filterFiles(displayJob, selecting, search, mediaType, status),
    [displayJob, selecting, search, mediaType, status],
  );
  const change = (files: TorrentFile[], checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const file of files) {
        if (checked) next.add(file.id);
        else next.delete(file.id);
      }
      return next;
    });
    setError("");
  };
  const submit = () =>
    selecting && chosen.length && !submitting
      ? submitSelection(
          { job, onSubmit, onClose },
          chosen,
          setSubmitting,
          setError,
        )
      : Promise.resolve();
  const changePriority = filePriorityAction(job, onPriorityChange, setError);
  return {
    adding,
    displayJob,
    startAdding: () => {
      setSelected(
        new Set(
          job.torrentFiles.filter((file) => !file.selected).map(({ id }) => id),
        ),
      );
      setSearch("");
      setMediaType("all");
      setAdding(true);
    },
    dialogRef,
    selecting,
    status,
    setStatus,
    selected,
    search,
    setSearch,
    mediaType,
    setMediaType,
    submitting,
    error,
    chosen,
    total: chosen.reduce((sum, file) => sum + file.size, 0),
    visible,
    change,
    submit,
    changePriority,
    canChangePriority: Boolean(onPriorityChange),
  };
}

export type Selection = ReturnType<typeof useTorrentSelection>;

export function TorrentFileDialog(props: Props) {
  const { job, onClose } = props;
  const selection = useTorrentSelection(props);
  const { dialogRef, selecting, submitting, error, chosen, total, submit } =
    selection;
  return (
    <dialog
      ref={dialogRef}
      className="download-dialog torrent-file-dialog"
      aria-labelledby="torrent-file-title"
      aria-describedby="torrent-file-description"
      onKeyDown={trapDialogTab}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onClose();
      }}
    >
      <form
        className="download-dialog-sheet torrent-file-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header>
          <div>
            <p className="panel-label">Torrent contents</p>
            <h2 id="torrent-file-title">
              {selection.adding
                ? "Download skipped files"
                : selecting
                  ? "Choose files"
                  : "Torrent files"}
            </h2>
          </div>
          <button
            type="button"
            className="ghost-button"
            disabled={submitting}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <FileTools job={selection.displayJob} selection={selection} />
        <FileList job={selection.displayJob} selection={selection} />
        <div className="torrent-file-feedback">
          <p role="status" aria-atomic="true">
            {submitting
              ? "Starting selected download…"
              : `${chosen.length} of ${selection.displayJob.torrentFiles.length} files selected · ${formatTransferBytes(total)}`}
          </p>
          {selecting && !chosen.length ? (
            <p>Select at least one file to start.</p>
          ) : null}
          {error ? (
            <p role="alert" className="download-confirm-error">
              {error}
            </p>
          ) : null}
        </div>
        <TorrentFileFooter job={job} selection={selection} />
      </form>
    </dialog>
  );
}

export function TorrentReviewAction({
  job,
  onSubmit,
  onPriorityChange,
}: Omit<Props, "onClose">) {
  const [reviewing, setReviewing] = useState(false);
  return (
    <>
      {job.torrentFiles.length ? (
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.focus();
            setReviewing(true);
          }}
        >
          {job.status === "awaiting_selection" ? "Review files" : "View files"}
        </button>
      ) : null}
      {reviewing ? (
        <TorrentFileDialog
          job={job}
          onSubmit={onSubmit}
          onPriorityChange={onPriorityChange}
          onClose={() => setReviewing(false)}
        />
      ) : null}
    </>
  );
}

function trapDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
  );
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function submitSelection(
  { job, onSubmit, onClose }: Props,
  chosen: TorrentFile[],
  setSubmitting: (_value: boolean) => void,
  setError: (_value: string) => void,
) {
  setSubmitting(true);
  setError("");
  try {
    await onSubmit(
      job.id,
      chosen.map(({ id }) => id),
    );
    onClose();
  } catch (cause) {
    setError(
      cause instanceof Error
        ? cause.message
        : "Could not start the selected download. Try again.",
    );
    setSubmitting(false);
  }
}

function TorrentFileFooter({
  job,
  selection,
}: {
  job: Job;
  selection: Selection;
}) {
  const { selecting, submitting, chosen } = selection;
  return (
    <>
      {selecting ? (
        <footer>
          <button
            key="start-selected"
            type="submit"
            className="primary-button"
            disabled={!chosen.length || submitting}
          >
            {submitting ? "Starting…" : "Start selected download"}
          </button>
        </footer>
      ) : ["ready", "paused"].includes(job.status) &&
        job.torrentFiles.some((file) => !file.selected) ? (
        <footer>
          <button
            key="download-skipped"
            type="button"
            className="primary-button"
            onClick={selection.startAdding}
          >
            Download skipped files
          </button>
        </footer>
      ) : null}
    </>
  );
}

function useTorrentChoices(job: Job) {
  const [adding, setAdding] = useState(false);
  const displayJob = useMemo(
    () =>
      adding
        ? {
            ...job,
            torrentFiles: job.torrentFiles.filter((file) => !file.selected),
          }
        : job,
    [adding, job],
  );
  const [selected, setSelected] = useState(
    () => new Set(job.torrentFiles.map(({ id }) => id)),
  );
  return { adding, setAdding, displayJob, selected, setSelected };
}
