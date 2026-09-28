import type { Job, TorrentFile } from "../../../../../shared/contracts";
import type { Selection } from "./TorrentFileDialog";
import { formatTransferBytes } from "../../../lib/formatterUtils";
import { MediaTypeFilter } from "../../../components/MediaTypeFilter";

const fileStates = {
  available: "Available",
  downloading: "Downloading",
  skipped: "Skipped",
  queued: "Queued",
  checking: "Checking existing data",
  downloaded: "Downloaded · preparing",
  paused: "Paused",
  confirmation: "Needs confirmation",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function fileState(
  file: TorrentFile,
  job: Job,
): keyof typeof fileStates {
  if (!file.selected) return "skipped";
  if (job.status === "error") return "failed";
  if (job.status === "cancelled") return "cancelled";
  if (job.status === "paused") return "paused";
  if (job.status === "queued") return "queued";
  if (job.status === "awaiting_confirmation") return "confirmation";
  if (job.phase === "resolving") return "checking";
  if (file.complete) return job.status === "ready" ? "available" : "downloaded";
  return "downloading";
}

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

export function FileTools({
  job,
  selection,
}: {
  job: Job;
  selection: Selection;
}) {
  const { selecting, search, mediaType, submitting, change, visible } =
    selection;
  return (
    <div className="torrent-file-tools">
      <p id="torrent-file-description">
        {selecting
          ? "Review the metadata and choose what to download. File contents have not started downloading."
          : "Reported file status for this download. Files become available when the selected download is ready and remain subject to session expiry. Skipped files cannot be added to this download."}
      </p>
      <label>
        Search files
        <input
          type="search"
          value={search}
          onChange={(event) => selection.setSearch(event.currentTarget.value)}
        />
      </label>
      <MediaTypeFilter
        value={mediaType}
        onChange={selection.setMediaType}
        disabled={submitting}
      />
      {!selecting ? (
        <label className="media-type-filter">
          File status
          <select
            value={selection.status}
            onChange={(event) => selection.setStatus(event.currentTarget.value)}
          >
            <option value="all">All files</option>
            {Object.entries(fileStates).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="torrent-file-bulk">
        {selecting ? (
          <>
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
          </>
        ) : null}
        <span>
          {visible.length} of {job.torrentFiles.length} files shown
        </span>
      </div>
      {selecting && (search || mediaType !== "all") ? (
        <p>
          Folder checkboxes affect matching files. Select all and Select none
          affect every file.
        </p>
      ) : null}
    </div>
  );
}

export function FileList({
  job,
  selection,
}: {
  job: Job;
  selection: Selection;
}) {
  const { selecting, submitting, selected, change, visible } = selection;
  const groups = new Map<string, TorrentFile[]>();
  for (const file of visible) {
    const folder = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "";
    const group = groups.get(folder) ?? [];
    group.push(file);
    groups.set(folder, group);
  }

  return (
    <div
      className="torrent-file-list"
      role="region"
      aria-label="Torrent files"
      aria-busy={submitting}
      tabIndex={selecting ? undefined : 0}
    >
      <fieldset disabled={submitting} className="torrent-file-fields">
        {[...groups].map(([folder, files]) =>
          selecting ? (
            <FileGroup
              key={folder}
              folder={folder}
              files={files}
              selected={selected}
              onChange={change}
            />
          ) : (
            <FileStatusGroup
              key={folder}
              job={job}
              folder={folder}
              files={files}
            />
          ),
        )}
      </fieldset>
      {!visible.length ? <p>No files match your filters.</p> : null}
    </div>
  );
}

function FileStatusGroup({
  job,
  folder,
  files,
}: {
  job: Job;
  folder: string;
  files: TorrentFile[];
}) {
  return (
    <fieldset className="torrent-file-group">
      <legend className="torrent-file-choice torrent-folder-choice">
        {folder || "Top-level files"}
      </legend>
      <ul className="torrent-file-status-list">
        {files.map((file) => (
          <li className="torrent-file-status-row" key={file.id}>
            <span>{file.path.slice(folder ? folder.length + 1 : 0)}</span>
            <small>{formatTransferBytes(file.size)}</small>
            <span className="torrent-file-state">
              {fileStates[fileState(file, job)]}
            </span>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
