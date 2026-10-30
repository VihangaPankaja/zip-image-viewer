import { archiveFiles, changeArchiveSelection } from "../archiveChoices";
import { useMemo, useState } from "react";
import type { ArchiveManifest } from "../../../../../shared/contracts";
import { formatTransferBytes } from "../../../lib/formatterUtils";
import { groupFiles } from "./TorrentFileList";
import { FileGroup } from "./TorrentFileGroups";
type File = ArchiveManifest["entries"][number] & { size: number };
function useNestedChoices(manifest: ArchiveManifest) {
  const files = useMemo(() => archiveFiles(manifest), [manifest]);
  const [selected, setSelected] = useState(
    () => new Set(files.filter((entry) => entry.extracted).map((entry) => entry.id)),
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const visible = files.filter((entry) => entry.path.toLowerCase().includes(search.toLowerCase()));
  const chosen = files.filter((entry) => selected.has(entry.id));
  const change = (entries: File[], checked: boolean) =>
    setSelected((current) => changeArchiveSelection(current, entries, checked));
  return { manifest, files, selected, search, setSearch, page, setPage, visible, chosen, change };
}
type Choices = ReturnType<typeof useNestedChoices>;
function NestedTools({ choices, busy }: { choices: Choices; busy: boolean }) {
  const { manifest, chosen, search, setSearch, setPage, change, files } = choices;
  return (
    <div className="torrent-file-tools">
      <p>
        Choose files to open. Previously extracted contents are kept. Solid archives may need to
        read preceding data.
      </p>
      <p>
        Source {formatTransferBytes(manifest.sourceBytes)} · Selected{" "}
        {formatTransferBytes(chosen.reduce((total, entry) => total + entry.size, 0))} expanded.
        Staging also needs a 64 MiB safety margin.
      </p>
      <label>
        Search archive files
        <input
          type="search"
          value={search}
          maxLength={200}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(0);
          }}
        />
      </label>
      <div className="torrent-file-bulk">
        <button
          className="ghost-button"
          type="button"
          disabled={busy}
          onClick={() => change(files, true)}
        >
          Select all
        </button>
        <button
          className="ghost-button"
          type="button"
          disabled={busy}
          onClick={() => change(files, false)}
        >
          Select none
        </button>
      </div>
    </div>
  );
}
function NestedList({ choices, busy }: { choices: Choices; busy: boolean }) {
  const { visible, page, setPage, selected, change } = choices;
  return (
    <div className="torrent-file-results">
      {visible.length > 100 ? (
        <nav className="torrent-file-pagination" aria-label="Archive file pages">
          <button type="button" disabled={busy || page === 0} onClick={() => setPage(page - 1)}>
            Previous files
          </button>
          <span>
            {page * 100 + 1}–{Math.min(visible.length, (page + 1) * 100)} of {visible.length}
          </span>
          <button
            type="button"
            disabled={busy || (page + 1) * 100 >= visible.length}
            onClick={() => setPage(page + 1)}
          >
            Next files
          </button>
        </nav>
      ) : null}
      <div className="torrent-file-list" role="region" aria-label="Nested archive files">
        <fieldset className="torrent-file-fields" disabled={busy}>
          {[...groupFiles(visible.slice(page * 100, (page + 1) * 100))].map(([folder, entries]) => (
            <FileGroup
              key={folder}
              folder={folder}
              files={entries}
              matchingFiles={visible.filter((entry) =>
                folder ? entry.path.startsWith(`${folder}/`) : !entry.path.includes("/"),
              )}
              selected={selected}
              onChange={change}
            />
          ))}
        </fieldset>
        {!visible.length ? <p>No files match your search.</p> : null}
      </div>
    </div>
  );
}
export function NestedChoices({
  manifest,
  busy,
  onExtract,
  error,
}: {
  manifest: ArchiveManifest;
  busy: boolean;
  onExtract: (fileIds: string[]) => void;
  error?: string;
}) {
  const choices = useNestedChoices(manifest);
  const { chosen } = choices;
  return (
    <>
      <div className="archive-file-body">
        <NestedTools choices={choices} busy={busy} />
        <NestedList choices={choices} busy={busy} />
      </div>
      <div className="torrent-file-feedback">
        <p role="status">{chosen.length} files selected</p>
        {error ? (
          <p role="alert" className="download-confirm-error">
            {error}
          </p>
        ) : null}
      </div>
      <footer>
        <button
          className="primary-button"
          type="button"
          disabled={busy || !chosen.length}
          onClick={() => onExtract(chosen.map((entry) => entry.id))}
        >
          {busy ? "Opening selected files…" : "Open selected files"}
        </button>
      </footer>
    </>
  );
}
