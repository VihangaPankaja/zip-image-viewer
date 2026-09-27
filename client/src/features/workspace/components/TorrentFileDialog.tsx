import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Job } from "../../../../../shared/contracts";
import { formatTransferBytes } from "../../../lib/formatterUtils";

type TorrentFile = Job["torrentFiles"][number];
type Props = {
  job: Job;
  onClose: () => void;
  onSubmit: (id: string, fileIds: string[]) => Promise<void>;
};

function FileGroup({
  folder,
  files,
  selected,
  onChange,
}: {
  folder: string;
  files: TorrentFile[];
  selected: Set<string>;
  onChange: (files: TorrentFile[], checked: boolean) => void;
}) {
  const count = files.filter((file) => selected.has(file.id)).length;
  return (
    <fieldset className="torrent-file-group">
      <legend>
        <label className="torrent-file-choice torrent-folder-choice">
          <input
            type="checkbox"
            checked={count === files.length}
            ref={(input) => {
              if (input)
                input.indeterminate = count > 0 && count < files.length;
            }}
            onChange={(event) => onChange(files, event.currentTarget.checked)}
          />
          <span>{folder || "Top-level files"}</span>
        </label>
      </legend>
      {files.map((file) => (
        <label className="torrent-file-choice" key={file.id}>
          <input
            type="checkbox"
            checked={selected.has(file.id)}
            aria-label={file.path}
            onChange={(event) => onChange([file], event.currentTarget.checked)}
          />
          <span>{file.path.slice(folder ? folder.length + 1 : 0)}</span>
          <small>{formatTransferBytes(file.size)}</small>
        </label>
      ))}
    </fieldset>
  );
}

function useTorrentSelection({ job, onClose, onSubmit }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(
    () => new Set(job.torrentFiles.map(({ id }) => id)),
  );
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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
  const chosen = job.torrentFiles.filter(({ id }) => selected.has(id));
  const total = chosen.reduce((sum, file) => sum + file.size, 0);
  const visible = job.torrentFiles.filter(({ path }) =>
    path.toLowerCase().includes(search.toLowerCase()),
  );
  const groups = new Map<string, TorrentFile[]>();
  for (const file of visible) {
    const folder = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "";
    const group = groups.get(folder) ?? [];
    group.push(file);
    groups.set(folder, group);
  }
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
    if (!chosen.length || submitting) return;
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
    selected,
    search,
    setSearch,
    submitting,
    error,
    chosen,
    total,
    visible,
    groups,
    change,
    submit,
  };
}

type Selection = ReturnType<typeof useTorrentSelection>;

export function TorrentFileDialog({ job, onClose, onSubmit }: Props) {
  const selection = useTorrentSelection({ job, onClose, onSubmit });
  const { dialogRef, submitting, error, chosen, total, submit } = selection;
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
            <h2 id="torrent-file-title">Choose files</h2>
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
        <FileList selection={selection} />
        <div className="torrent-file-feedback">
          <p role="status" aria-atomic="true">
            {submitting
              ? "Starting selected download…"
              : `${chosen.length} of ${job.torrentFiles.length} files selected · ${formatTransferBytes(total)}`}
          </p>
          {!chosen.length ? <p>Select at least one file to start.</p> : null}
          {error ? (
            <p role="alert" className="download-confirm-error">
              {error}
            </p>
          ) : null}
        </div>
        <footer>
          <button
            type="submit"
            className="primary-button"
            disabled={!chosen.length || submitting}
          >
            {submitting ? "Starting…" : "Start selected download"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export function TorrentReviewAction({ job, onSubmit }: Omit<Props, "onClose">) {
  const [reviewing, setReviewing] = useState(false);
  return (
    <>
      {job.status === "awaiting_selection" ? (
        <button type="button" onClick={() => setReviewing(true)}>
          Review files
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

function FileTools({ job, selection }: { job: Job; selection: Selection }) {
  const { search, setSearch, submitting, change, visible } = selection;
  return (
    <div className="torrent-file-tools">
      <p id="torrent-file-description">
        Review the metadata and choose what to download. File contents have not
        started downloading.
      </p>
      <label>
        Search files
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </label>
      <div className="torrent-file-bulk">
        <button
          type="button"
          className="ghost-button"
          disabled={submitting}
          onClick={() => change(job.torrentFiles, true)}
        >
          Select all
        </button>
        <button
          type="button"
          className="ghost-button"
          disabled={submitting}
          onClick={() => change(job.torrentFiles, false)}
        >
          Select none
        </button>
        <span>
          {visible.length} of {job.torrentFiles.length} files shown
        </span>
      </div>
      {search ? (
        <p>
          Folder checkboxes affect matching files. Select all and Select none
          affect every file.
        </p>
      ) : null}
    </div>
  );
}

function FileList({ selection }: { selection: Selection }) {
  const { submitting, groups, selected, change, visible } = selection;
  return (
    <div
      className="torrent-file-list"
      aria-label="Torrent files"
      aria-busy={submitting}
    >
      <fieldset disabled={submitting} className="torrent-file-fields">
        {[...groups].map(([folder, files]) => (
          <FileGroup
            key={folder}
            folder={folder}
            files={files}
            selected={selected}
            onChange={change}
          />
        ))}
      </fieldset>
      {!visible.length ? <p>No files match your search.</p> : null}
    </div>
  );
}

function trapDialogTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled)",
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
