import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Job } from "../../../../../shared/contracts";
import { formatTransferBytes } from "../../../lib/formatterUtils";
import { classifyExtension } from "../../../lib/mimeTypeSystem";
import { FileList, FileTools, fileState } from "./TorrentFileContents";

type TorrentFile = Job["torrentFiles"][number];
type Props = {
  job: Job;
  onClose: () => void;
  onSubmit: (id: string, fileIds: string[]) => Promise<void>;
};

function useTorrentDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      requestAnimationFrame(() => {
        if (dialog?.open) return;
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        else document.getElementById("downloads-title")?.focus();
      });
    };
  }, []);
  return dialogRef;
}

function useTorrentSelection({ job, onClose, onSubmit }: Props) {
  const selecting = job.status === "awaiting_selection";
  const dialogRef = useTorrentDialog();
  const [selected, setSelected] = useState(
    () => new Set(job.torrentFiles.map(({ id }) => id)),
  );
  const [search, setSearch] = useState("");
  const [mediaType, setMediaType] = useState("all");
  const [status, setStatus] = useState("all");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const chosen = job.torrentFiles.filter((file) =>
    selecting ? selected.has(file.id) : file.selected,
  );
  const total = chosen.reduce((sum, file) => sum + file.size, 0);
  const visible = job.torrentFiles.filter((file) => {
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
  const submit = async () => {
    if (!selecting || !chosen.length || submitting) return;
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
  };
  return {
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
    total,
    visible,
    change,
    submit,
  };
}

export type Selection = ReturnType<typeof useTorrentSelection>;

export function TorrentFileDialog({ job, onClose, onSubmit }: Props) {
  const selection = useTorrentSelection({ job, onClose, onSubmit });
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
              {selecting ? "Choose files" : "Torrent files"}
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
        <FileTools job={job} selection={selection} />
        <FileList job={job} selection={selection} />
        <div className="torrent-file-feedback">
          <p role="status" aria-atomic="true">
            {submitting
              ? "Starting selected download…"
              : `${chosen.length} of ${job.torrentFiles.length} files selected · ${formatTransferBytes(total)}`}
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
        {selecting ? (
          <footer>
            <button
              type="submit"
              className="primary-button"
              disabled={!chosen.length || submitting}
            >
              {submitting ? "Starting…" : "Start selected download"}
            </button>
          </footer>
        ) : null}
      </form>
    </dialog>
  );
}

export function TorrentReviewAction({ job, onSubmit }: Omit<Props, "onClose">) {
  const [reviewing, setReviewing] = useState(false);
  return (
    <>
      {job.torrentFiles.length ? (
        <button type="button" onClick={() => setReviewing(true)}>
          {job.status === "awaiting_selection" ? "Review files" : "View files"}
        </button>
      ) : null}
      {reviewing ? (
        <TorrentFileDialog
          job={job}
          onSubmit={onSubmit}
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
