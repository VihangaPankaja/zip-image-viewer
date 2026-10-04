import type {
  Job,
  TorrentFile,
  TorrentPriority,
} from "../../../../../shared/contracts";
import type { Selection } from "./TorrentFileDialog";
import { formatTransferBytes } from "../../../lib/formatterUtils";
import { fileState, fileStates } from "./TorrentFileContents";

export function FileGroup({
  folder,
  files,
  matchingFiles,
  selected,
  onChange,
}: {
  folder: string;
  files: TorrentFile[];
  matchingFiles: TorrentFile[];
  selected: Set<string>;
  onChange: (files: TorrentFile[], checked: boolean) => void;
}) {
  const count = matchingFiles.filter((file) => selected.has(file.id)).length;
  return (
    <fieldset className="torrent-file-group">
      <legend>
        <label className="torrent-file-choice torrent-folder-choice">
          <input
            type="checkbox"
            checked={count === matchingFiles.length}
            ref={(input) => {
              if (input)
                input.indeterminate = count > 0 && count < matchingFiles.length;
            }}
            onChange={(event) =>
              onChange(matchingFiles, event.currentTarget.checked)
            }
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

export function FileStatusGroup({
  job,
  folder,
  files,
  selection,
}: {
  job: Job;
  folder: string;
  files: TorrentFile[];
  selection: Selection;
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
            {file.selected &&
            job.status === "downloading" &&
            selection.canChangePriority ? (
              <label>
                <select
                  aria-label={`Priority for ${file.path}`}
                  value={file.priority ?? "normal"}
                  onChange={(event) =>
                    void selection.changePriority(
                      file.id,
                      event.currentTarget.value as TorrentPriority,
                    )
                  }
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>
            ) : null}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
