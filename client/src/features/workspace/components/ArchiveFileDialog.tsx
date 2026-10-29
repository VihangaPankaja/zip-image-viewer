import { ArchiveInspectionFeedback } from "./ArchiveInspectionFeedback";
import { archiveFiles, changeArchiveSelection } from "../archiveChoices";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ArchiveManifest, Job } from "../../../../../shared/contracts";
import { useModalDialog } from "../../../hooks/useModalDialog";
import { formatTransferBytes } from "../../../lib/formatterUtils";
import { workspaceRpc } from "../../../services/orpcClient";
import { FileGroup } from "./TorrentFileGroups";
import { groupFiles } from "./TorrentFileList";

type ArchiveFile = ArchiveManifest["entries"][number] & { size: number };
const pageSize = 100;

function useArchiveChoices({
  manifest,
  job,
  onClose,
}: {
  manifest: ArchiveManifest;
  job: Job;
  onClose: () => void;
}) {
  const files = useMemo(() => archiveFiles(manifest), [manifest]);
  const available = useMemo(() => files.filter((file) => !file.extracted), [files]);
  const [selected, setSelected] = useState(() => new Set(available.map((file) => file.id)));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const client = useQueryClient();
  const submit = useMutation(
    workspaceRpc.archives.select.mutationOptions({
      onSuccess: async () => {
        await client.invalidateQueries();
        onClose();
      },
    }),
  );
  const visible = useMemo(
    () => available.filter((entry) => entry.path.toLowerCase().includes(search.toLowerCase())),
    [available, search],
  );
  const groups = groupFiles(visible.slice(page * pageSize, (page + 1) * pageSize));
  const matchingGroups = useMemo(() => groupFiles(visible), [visible]);
  const change = (entries: ArchiveFile[], checked: boolean) =>
    setSelected((current) => changeArchiveSelection(current, entries, checked));
  const chosen = useMemo(
    () => available.filter((file) => selected.has(file.id)),
    [available, selected],
  );
  const expanded = useMemo(
    () =>
      files
        .filter((file) => file.extracted || selected.has(file.id))
        .reduce((total, entry) => total + entry.expandedBytes, 0),
    [files, selected],
  );
  const busy = submit.isPending;
  const canSelect = ["awaiting_selection", "ready"].includes(job.status);
  return {
    manifest,
    job,
    files,
    available,
    selected,
    search,
    setSearch,
    page,
    setPage,
    submit,
    visible,
    groups,
    matchingGroups,
    change,
    chosen,
    expanded,
    busy,
    canSelect,
  };
}
type Choices = ReturnType<typeof useArchiveChoices>;

function ArchiveTools({ choices }: { choices: Choices }) {
  const {
    manifest,
    expanded,
    search,
    setSearch,
    setPage,
    busy,
    canSelect,
    available,
    change,
    visible,
  } = choices;
  return (
    <div className="torrent-file-tools">
      <p>
        The ZIP source is kept. Only selected files are extracted. Extract more later without
        downloading the source again. Solid 7z/RAR archives use the existing full extraction flow
        and may need to read preceding data.
      </p>
      <dl className="storage-totals">
        <div>
          <dt>Retained ZIP source</dt>
          <dd>{formatTransferBytes(manifest.sourceBytes)}</dd>
        </div>
        <div>
          <dt>Selected contents after extraction</dt>
          <dd>{formatTransferBytes(expanded)}</dd>
        </div>
        <div>
          <dt>Free space needed for staging</dt>
          <dd>{formatTransferBytes(expanded)} + 64 MiB safety margin</dd>
        </div>
      </dl>
      <p>Already extracted files stay available while the new selection is prepared.</p>
      <label>
        Search ZIP files
        <input
          type="search"
          value={search}
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
          disabled={busy || !canSelect}
          onClick={() => change(available, true)}
        >
          Select all
        </button>
        <button
          className="ghost-button"
          type="button"
          disabled={busy || !canSelect}
          onClick={() => change(available, false)}
        >
          Select none
        </button>
        <span>
          {visible.length} {visible.length === 1 ? "file" : "files"} available ·{" "}
          {manifest.extractedCount} already extracted
        </span>
      </div>
      <p>
        Folder choices affect matching files across all pages. Select all and Select none include
        files hidden by search.
      </p>
    </div>
  );
}

function ArchiveList({ choices }: { choices: Choices }) {
  const {
    visible,
    page,
    setPage,
    busy,
    canSelect,
    groups,
    matchingGroups,
    selected,
    change,
    available,
  } = choices;
  return (
    <div className="torrent-file-results">
      {visible.length > pageSize ? (
        <nav className="torrent-file-pagination" aria-label="ZIP file pages">
          <button
            className="ghost-button"
            type="button"
            disabled={busy || page === 0}
            onClick={() => setPage(page - 1)}
          >
            Previous files
          </button>
          <span>
            {page * pageSize + 1}–{Math.min(visible.length, (page + 1) * pageSize)} of{" "}
            {visible.length}
          </span>
          <button
            className="ghost-button"
            type="button"
            disabled={busy || (page + 1) * pageSize >= visible.length}
            onClick={() => setPage(page + 1)}
          >
            Next files
          </button>
        </nav>
      ) : null}
      <div className="torrent-file-list" role="region" aria-label="ZIP files">
        <fieldset className="torrent-file-fields" disabled={busy || !canSelect}>
          {[...groups].map(([folder, entries]) => (
            <FileGroup
              key={folder}
              folder={folder}
              files={entries}
              matchingFiles={
                folder
                  ? visible.filter((entry) => entry.path.startsWith(`${folder}/`))
                  : (matchingGroups.get(folder) ?? entries)
              }
              selected={selected}
              onChange={change}
            />
          ))}
        </fieldset>
        {!visible.length ? (
          <p>
            {available.length
              ? "No files match your search."
              : "All ZIP files have been extracted."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ArchiveFooter({ choices }: { choices: Choices }) {
  const { chosen, submit, busy, canSelect, job, manifest } = choices;
  return (
    <>
      <div className="torrent-file-feedback">
        <p role="status">
          {chosen.length} {chosen.length === 1 ? "file" : "files"} selected ·{" "}
          {formatTransferBytes(chosen.reduce((total, entry) => total + entry.expandedBytes, 0))}{" "}
          expanded ·{" "}
          {formatTransferBytes(chosen.reduce((total, entry) => total + entry.compressedBytes, 0))}{" "}
          compressed
        </p>
        {submit.error ? (
          <p role="alert" className="download-confirm-error">
            {submit.error.message}
          </p>
        ) : null}
      </div>
      <footer>
        <button
          className="primary-button"
          type="button"
          disabled={!canSelect || busy || !chosen.length}
          onClick={() =>
            submit.mutate({
              id: job.id,
              fingerprint: manifest.fingerprint,
              fileIds: chosen.map((entry) => entry.id),
            })
          }
        >
          {busy ? "Starting…" : "Extract selected files"}
        </button>
      </footer>
    </>
  );
}

function ArchiveChoices(props: { manifest: ArchiveManifest; job: Job; onClose: () => void }) {
  const choices = useArchiveChoices(props);
  return (
    <>
      <div className="archive-file-body">
        <ArchiveTools choices={choices} />
        <ArchiveList choices={choices} />
      </div>
      <ArchiveFooter choices={choices} />
    </>
  );
}

function ArchiveFileDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const dialog = useModalDialog();
  const manifest = useQuery(
    workspaceRpc.archives.get.queryOptions({ input: { id: job.id }, retry: false }),
  );
  return (
    <dialog
      ref={dialog}
      className="download-dialog torrent-file-dialog"
      aria-labelledby="archive-file-title"
      onCancel={onClose}
    >
      <div className="download-dialog-sheet archive-file-sheet">
        <header>
          <h2 id="archive-file-title">Choose ZIP contents</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </header>
        <ArchiveInspectionFeedback
          pending={manifest.isPending}
          error={manifest.error?.message}
          onRetry={() => void manifest.refetch()}
          label="ZIP"
        />
        {manifest.data ? (
          <ArchiveChoices
            key={manifest.data.fingerprint}
            manifest={manifest.data}
            job={job}
            onClose={onClose}
          />
        ) : null}
      </div>
    </dialog>
  );
}

export function ArchiveReviewAction({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  if (!job.archive) return null;
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        {job.status === "awaiting_selection"
          ? "Review ZIP contents"
          : job.status === "ready" && job.archive.extractedCount < job.archive.fileCount
            ? "Extract more"
            : "View ZIP contents"}
      </button>
      {open ? <ArchiveFileDialog job={job} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
