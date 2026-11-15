import { useEffect, useRef, useState } from "react";
import type { PageDiscovery } from "../../../../../shared/contracts";
import type { DownloadOptions } from "../../../types/download";
import { usePageDiscovery } from "../usePageDiscovery";

type Props = {
  defaultOptions: DownloadOptions;
  onSubmit: (
    _items: { url: string; downloadOptions: DownloadOptions; sourcePreference: "auto" }[],
  ) => Promise<void>;
  onBack: () => void;
  onClose: () => void;
};
type Discovery = ReturnType<typeof usePageDiscovery>;

function CandidateRow({
  item,
  discovery,
  busy,
}: {
  item: PageDiscovery["items"][number];
  discovery: Discovery;
  busy: boolean;
}) {
  const selected = discovery.selected.has(item.url);
  return (
    <label className="discovery-candidate" aria-label={item.name}>
      <input
        type="checkbox"
        checked={selected}
        disabled={busy || item.kind === "page" || (!selected && discovery.selected.size >= 50)}
        onChange={() => discovery.toggle(item.url)}
      />
      <span className="discovery-candidate-content">
        <strong>{item.name}</strong>
        <span className="discovery-url" title={item.url}>
          {item.url}
        </span>
        <span className="discovery-meta">
          {item.kind === "file" ? "File candidate" : "Page / unconfirmed"} · {item.type} ·{" "}
          {item.confidence} confidence · Size unknown
        </span>
      </span>
    </label>
  );
}

function CandidateList({ discovery, busy }: { discovery: Discovery; busy: boolean }) {
  const data = discovery.inspection.data;
  if (!data) return null;
  const start = discovery.page * 20;
  return (
    <section className="discovery-results" aria-label="Discovered links">
      <p className="discovery-meta">
        Source page <span className="discovery-url">{data.sourcePage}</span>
      </p>
      <p role="status">
        {data.items.length} links found.{" "}
        {data.items.length
          ? "Select up to 50 file candidates. Files are not fetched until you add them."
          : "No public download links found. Try a different page or use direct links."}
      </p>
      {data.truncated ? (
        <p>Showing the first 500 links. Inspect a more specific page to find others.</p>
      ) : null}
      {data.items.slice(start, start + 20).map((item) => (
        <CandidateRow key={item.url} item={item} discovery={discovery} busy={busy} />
      ))}
      {data.items.length > 20 ? (
        <nav className="discovery-pagination" aria-label="Link pages">
          <button
            className="ghost-button"
            type="button"
            disabled={!discovery.page || busy}
            onClick={() => discovery.setPage(discovery.page - 1)}
          >
            Previous links
          </button>
          <span>
            {start + 1}–{Math.min(start + 20, data.items.length)} of {data.items.length}
          </span>
          <button
            className="ghost-button"
            type="button"
            disabled={start + 20 >= data.items.length || busy}
            onClick={() => discovery.setPage(discovery.page + 1)}
          >
            Next links
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function useSelectedSubmission(
  defaultOptions: DownloadOptions,
  onSubmit: Props["onSubmit"],
  discovery: Discovery,
) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const busy = adding || discovery.inspection.isPending;
  const addSelected = async () => {
    if (busy || !discovery.selected.size) return;
    setAdding(true);
    setError("");
    try {
      await onSubmit(
        [...discovery.selected].map((url) => ({
          url,
          downloadOptions: structuredClone(defaultOptions),
          sourcePreference: "auto",
        })),
      );
      discovery.reset();
      discovery.setUrl("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add selected files.");
    } finally {
      setAdding(false);
    }
  };
  return { busy, adding, error, setError, addSelected };
}

function PageSearch({ discovery, busy }: { discovery: Discovery; busy: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="download-compose">
      <label>
        <span>Page URL</span>
        <input
          ref={inputRef}
          type="url"
          required
          maxLength={2048}
          value={discovery.url}
          disabled={busy}
          placeholder="https://example.com/downloads"
          onChange={(event) => discovery.setUrl(event.currentTarget.value)}
        />
      </label>
      <p className="discovery-meta">
        Inspects one public HTML page. File types are hints; sizes stay unknown until download.
      </p>
      {discovery.inspection.isPending ? (
        <button type="button" className="ghost-button" onClick={discovery.cancel}>
          Cancel inspection
        </button>
      ) : (
        <button className="ghost-button" type="submit" disabled={busy || !discovery.url.trim()}>
          Inspect page
        </button>
      )}
      {discovery.inspection.isPending ? <p role="status">Inspecting page…</p> : null}
    </div>
  );
}

export function PageDiscoveryForm({ defaultOptions, onSubmit, onBack, onClose }: Props) {
  const discovery = usePageDiscovery();
  const { busy, adding, error, setError, addSelected } = useSelectedSubmission(
    defaultOptions,
    onSubmit,
    discovery,
  );
  return (
    <form
      className="download-dialog-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (!busy) discovery.inspect();
      }}
    >
      <header>
        <h2 id="download-dialog-title">Find downloads on a page</h2>
        <button type="button" className="ghost-button" disabled={adding} onClick={onBack}>
          Direct links
        </button>
        <button type="button" className="ghost-button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="download-dialog-body">
        <PageSearch discovery={discovery} busy={busy} />
        <CandidateList discovery={discovery} busy={busy} />
      </div>
      {error || discovery.inspection.error ? (
        <p className="download-submit-error" role="alert">
          {error || discovery.inspection.error?.message}
        </p>
      ) : null}
      <footer>
        <span>{discovery.selected.size} of 50 selected</span>
        <button
          className="primary-button"
          type="button"
          disabled={busy || !discovery.selected.size}
          onClick={() => void addSelected()}
        >
          {adding ? "Adding…" : "Add selected"}
        </button>
      </footer>
    </form>
  );
}
