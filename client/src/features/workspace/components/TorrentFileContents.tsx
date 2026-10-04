import type { Job, TorrentFile } from "../../../../../shared/contracts";
import type { Selection } from "./TorrentFileDialog";
import { MediaTypeFilter } from "../../../components/MediaTypeFilter";

export const fileStates = {
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
          : "Reported file status for this download. Files become available when the selected download is ready and remain subject to session expiry. Skipped files cannot be added to this download. File priority changes download order when peers have the pieces; it cannot make unavailable pieces appear."}
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
      <SelectionHelp selecting={selecting} />
      {selecting && (search || mediaType !== "all") ? (
        <p>
          Folder checkboxes affect matching files. Select all and Select none
          affect every file, including other pages.
        </p>
      ) : null}
    </div>
  );
}

function SelectionHelp({ selecting }: { selecting: boolean }) {
  return selecting ? (
    <p id="torrent-keyboard-help">
      Use ↑ and ↓ to move between choices, Home and End to jump to the first or
      last file, and Space to select. Folder checkboxes affect all matching
      files, including other pages.
    </p>
  ) : null;
}
