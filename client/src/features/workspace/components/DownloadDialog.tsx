import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DownloadOptions } from "../../../types/download";

type DownloadItem = {
  url: string;
  downloadOptions: DownloadOptions;
  sourcePreference: "auto" | "http" | "torrent";
};
type DownloadDraft = DownloadItem & { id: string };
type DownloadDialogProps = {
  defaultOptions: DownloadOptions;
  open: boolean;
  onClose: () => void;
  onSubmit: (items: DownloadItem[]) => void;
};

function parseDrafts(value: string, options: DownloadOptions, startId: number) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((url, index): DownloadDraft => ({
      id: `download-${String(startId + index)}`,
      url,
      downloadOptions: structuredClone(options),
      sourcePreference: "auto",
    }));
}

function validHttpUrl(value: string): boolean {
  if (value.startsWith("magnet:")) {
    if (!URL.canParse(value)) return false;
    return new URL(value).searchParams
      .getAll("xt")
      .some((item) => /^urn:btih:(?:[a-f\d]{40}|[a-z2-7]{32})$/i.test(item));
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validDraft(draft: DownloadDraft): boolean {
  return (
    validHttpUrl(draft.url) &&
    !(draft.url.startsWith("magnet:") && draft.sourcePreference === "http")
  );
}

function DraftSettings({
  draft,
  onChange,
}: {
  draft: DownloadDraft;
  onChange: (draft: DownloadDraft) => void;
}) {
  const updateTransport = (threads: number) =>
    onChange({
      ...draft,
      downloadOptions: {
        ...draft.downloadOptions,
        transport: { ...draft.downloadOptions.transport, threads },
      },
    });
  const updateRetries = (maxRetries: number) =>
    onChange({
      ...draft,
      downloadOptions: {
        ...draft.downloadOptions,
        retry: { ...draft.downloadOptions.retry, maxRetries },
      },
    });
  return (
    <details>
      <summary>Per-download settings</summary>
      <div className="draft-settings">
        <label>
          <span>Source type</span>
          <select
            value={draft.sourcePreference}
            onChange={(event) =>
              onChange({
                ...draft,
                sourcePreference: event.currentTarget
                  .value as DownloadItem["sourcePreference"],
              })
            }
          >
            <option value="auto">Auto detect</option>
            <option value="http">HTTP Direct</option>
            <option value="torrent">Torrent</option>
          </select>
        </label>
        <label>
          <span>Threads</span>
          <input
            type="number"
            min="1"
            max="8"
            value={draft.downloadOptions.transport.threads}
            onChange={(event) =>
              updateTransport(Number(event.currentTarget.value))
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
              updateRetries(Number(event.currentTarget.value))
            }
          />
        </label>
      </div>
    </details>
  );
}

function DownloadDraftRow({
  draft,
  index,
  duplicate,
  onChange,
  onRemove,
}: {
  draft: DownloadDraft;
  index: number;
  duplicate: boolean;
  onChange: (draft: DownloadDraft) => void;
  onRemove: () => void;
}) {
  const valid = validDraft(draft) && !duplicate;
  return (
    <article className={valid ? "download-draft" : "download-draft invalid"}>
      <span className="draft-index">{String(index + 1).padStart(2, "0")}</span>
      <label>
        <span>Download URL</span>
        <input
          value={draft.url}
          aria-invalid={!valid}
          onChange={(event) =>
            onChange({ ...draft, url: event.currentTarget.value })
          }
        />
      </label>
      <DraftSettings draft={draft} onChange={onChange} />
      <button
        type="button"
        className="ghost-button"
        aria-label={`Remove ${draft.url}`}
        onClick={onRemove}
      >
        Remove
      </button>
    </article>
  );
}

function DownloadCompose({
  source,
  setSource,
  addDrafts,
}: {
  source: string;
  setSource: (value: string) => void;
  addDrafts: () => void;
}) {
  return (
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
      <button className="ghost-button" type="button" onClick={addDrafts}>
        Review links
      </button>
    </div>
  );
}

function DraftList({
  drafts,
  urlCounts,
  setDrafts,
}: {
  drafts: DownloadDraft[];
  urlCounts: Map<string, number>;
  setDrafts: Dispatch<SetStateAction<DownloadDraft[]>>;
}) {
  return (
    <div className="download-drafts" aria-live="polite">
      {drafts.map((draft, index) => (
        <DownloadDraftRow
          key={draft.id}
          draft={draft}
          index={index}
          duplicate={(urlCounts.get(draft.url) ?? 0) > 1}
          onChange={(next) =>
            setDrafts((current) =>
              current.map((item) => (item.id === next.id ? next : item)),
            )
          }
          onRemove={() =>
            setDrafts((current) => current.filter(({ id }) => id !== draft.id))
          }
        />
      ))}
    </div>
  );
}

function DialogFooter({
  drafts,
  invalidCount,
  duplicateCount,
}: {
  drafts: DownloadDraft[];
  invalidCount: number;
  duplicateCount: number;
}) {
  return (
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
  );
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
  const invalidCount = drafts.filter((draft) => !validDraft(draft)).length;
  const duplicateCount = drafts.filter(
    ({ url }) => (urlCounts.get(url) ?? 0) > 1,
  ).length;
  const addDrafts = () => {
    const added = parseDrafts(
      source,
      defaultOptions,
      nextDraftId.current,
    ).slice(0, Math.max(0, 50 - drafts.length));
    nextDraftId.current += added.length;
    setDrafts((current) => [...current, ...added]);
    setSource("");
  };
  const submit = () => onSubmit(drafts.map(({ id: _, ...item }) => item));
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
          if (!invalidCount && !duplicateCount && drafts.length) submit();
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
        <DownloadCompose
          source={source}
          setSource={setSource}
          addDrafts={addDrafts}
        />
        <DraftList
          drafts={drafts}
          urlCounts={urlCounts}
          setDrafts={setDrafts}
        />
        <DialogFooter
          drafts={drafts}
          invalidCount={invalidCount}
          duplicateCount={duplicateCount}
        />
      </form>
    </dialog>
  );
}
