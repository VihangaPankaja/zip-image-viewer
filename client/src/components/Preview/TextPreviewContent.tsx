import { useState } from "react";
import type { PreviewFileNode } from "../../features/workspace/types";
import type { TextPreviewState } from "../../hooks/useTextPreview";
import { TextChunkNavigation } from "./TextChunkNavigation";
import { formatPreviewJson } from "../../features/workspace/textPreviewFormats";
import { TextPreviewRows } from "./TextPreviewRows";
import { TextPreviewTable } from "./TextPreviewTable";

export type TextPreviewContentProps = {
  formatBytes: (value: number) => string;
  formatDate: (value: number) => string;
  selectedNode: PreviewFileNode;
  textPreview: TextPreviewState;
};

export function TextPreviewContent({
  selectedNode,
  formatBytes,
  formatDate,
  textPreview,
}: TextPreviewContentProps) {
  const { chunk, error, loading, loadOffset } = textPreview;
  return (
    <div className="text-preview" aria-busy={loading}>
      <div className="preview-toolbar">
        <span>{formatBytes(chunk?.totalBytes ?? selectedNode.size ?? 0)}</span>
        <span>{(selectedNode.extension || "text").toUpperCase()} preview</span>
        <span>{formatDate(selectedNode.modifiedAt ?? 0)}</span>
      </div>
      {loading && (
        <p role="status">
          Loading bounded text chunk. The previous chunk stays visible until it is ready.
        </p>
      )}
      {error && <p role="alert">Preview unavailable: {error}</p>}
      {chunk && (
        <>
          <p className="text-preview-note">
            Bytes {chunk.offset.toLocaleString()}–{chunk.nextOffset.toLocaleString()} of{" "}
            {chunk.totalBytes.toLocaleString()} · {chunk.encoding.toUpperCase()} ·{" "}
            {chunk.offset > 0 || chunk.nextOffset < chunk.totalBytes
              ? "Truncated preview"
              : "Complete file"}
          </p>
          {chunk.replacementCharacters && (
            <p className="text-preview-note">
              Invalid or unsupported encoded characters appear as �.
            </p>
          )}
          {(chunk.offset > 0 || chunk.nextOffset < chunk.totalBytes) && (
            <TextChunkNavigation chunk={chunk} loading={loading} loadOffset={loadOffset} />
          )}
          {chunk.binary ? (
            <p role="status">
              Binary content detected. Text preview is hidden. Use Open raw to read this file.
            </p>
          ) : (
            <TextChunkView
              key={`${selectedNode.path}:${chunk.offset}`}
              chunk={chunk}
              extension={selectedNode.extension ?? ""}
            />
          )}
        </>
      )}
    </div>
  );
}

type Chunk = NonNullable<TextPreviewState["chunk"]>;
function TextChunkView({ chunk, extension }: { chunk: Chunk; extension: string }) {
  const [wrap, setWrap] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("raw");
  const [formatted, setFormatted] = useState<{ text: string; message: string } | null>(null);
  const [copied, setCopied] = useState("");
  const complete = chunk.offset === 0 && chunk.nextOffset === chunk.totalBytes;
  const table = /^(csv|tsv)$/i.test(extension);
  const content = view === "json" ? (formatted?.text ?? chunk.text) : chunk.text;
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied("Loaded text copied.");
    } catch {
      setCopied("Copy unavailable. Select text in the preview or download the original.");
    }
  }
  function format() {
    setFormatted(formatPreviewJson(chunk.text));
    setView("json");
  }
  return (
    <>
      <TextViewActions
        chunk={chunk}
        extension={extension}
        controls={{ wrap, setWrap, view, setView, copy, format }}
      />
      {!complete && (table || extension === "json") && (
        <p className="text-preview-note">
          JSON formatting needs a complete file; table mode starts in the first chunk.
        </p>
      )}
      <label className="text-preview-search">
        Search {complete ? "complete file" : "loaded chunk only"}
        <input
          type="search"
          maxLength={200}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (view === "table") setView("raw");
          }}
        />
      </label>
      <p className="text-preview-note">
        {complete
          ? "Search covers this complete file."
          : "Search covers the loaded chunk only; the whole file has not been searched."}{" "}
        {view === "json" ? "Search uses formatted text." : "Search uses raw text."}
      </p>
      <p className="text-preview-note" role="status">
        {copied || (view === "json" ? formatted?.message : "")}
      </p>
      {view === "table" ? (
        <TextPreviewTable
          text={chunk.text}
          delimiter={extension.toLowerCase() === "tsv" ? "\t" : ","}
          complete={complete}
        />
      ) : (
        <TextPreviewRows text={content} wrap={wrap} query={query} />
      )}
      {!chunk.text && <p className="text-preview-note">Empty file.</p>}
    </>
  );
}

function TextViewActions({
  chunk,
  extension,
  controls,
}: {
  chunk: Chunk;
  extension: string;
  controls: {
    wrap: boolean;
    setWrap: (value: boolean) => void;
    view: string;
    setView: (value: string) => void;
    copy: () => Promise<void>;
    format: () => void;
  };
}) {
  const { wrap, setWrap, view, setView, copy, format } = controls;
  const complete = chunk.offset === 0 && chunk.nextOffset === chunk.totalBytes;
  const table = /^(csv|tsv)$/i.test(extension);
  return (
    <div className="text-preview-actions">
      <label>
        <input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />
        Wrap lines
      </label>
      <button
        type="button"
        className="ghost-button"
        onClick={() => {
          void copy();
        }}
      >
        Copy loaded text
      </button>
      {(table || extension.toLowerCase() === "json") && (
        <button
          type="button"
          className="ghost-button"
          aria-pressed={view === "raw"}
          onClick={() => setView("raw")}
        >
          Raw text
        </button>
      )}
      {extension.toLowerCase() === "json" && (
        <button
          type="button"
          className="ghost-button"
          disabled={!complete}
          aria-pressed={view === "json"}
          onClick={format}
        >
          Format JSON
        </button>
      )}
      {table && (
        <button
          type="button"
          className="ghost-button"
          disabled={chunk.offset !== 0}
          aria-pressed={view === "table"}
          onClick={() => setView("table")}
        >
          Table
        </button>
      )}
    </div>
  );
}
