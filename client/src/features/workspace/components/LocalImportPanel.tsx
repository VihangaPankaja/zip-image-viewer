import { useState } from "react";
import type { LocalImportItem } from "../useLocalImports";
import { formatTransferBytes } from "../../../lib/formatterUtils";

type Imports = {
  items: LocalImportItem[];
  error: string;
  add: (_files: File[]) => void;
  retry: (_id: string) => void;
  cancel: (_id: string) => unknown;
};

export function LocalImportPanel({ imports }: { imports: Imports }) {
  const [dropError, setDropError] = useState("");
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The file drop region has a native keyboard-accessible picker.
    <section
      className="local-import"
      aria-labelledby="local-import-title"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropError("");
        if (
          Array.from(event.dataTransfer.items).some((item) => item.webkitGetAsEntry()?.isDirectory)
        ) {
          setDropError(
            "To import a folder, create a ZIP first. Directory drops are not supported.",
          );
          return;
        }
        imports.add(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="local-import-heading">
        <div>
          <h2 id="local-import-title">Import local files</h2>
          <p>Drop files here or choose files from your device.</p>
        </div>
        <label className="local-import-picker">
          Choose local files
          <input
            aria-label="Choose local files"
            type="file"
            multiple
            onChange={(event) => {
              imports.add(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      <p className="local-import-hint">
        ZIP, images, text and audio. Up to 10 GiB per file. For folders, create a ZIP first.
      </p>
      {dropError || imports.error ? <p role="alert">{dropError || imports.error}</p> : null}
      {imports.items.length ? (
        <ul className="local-import-list">
          {imports.items.map((item) => (
            <LocalImportRow key={item.id} item={item} imports={imports} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function LocalImportRow({ item, imports }: { item: LocalImportItem; imports: Imports }) {
  return (
    <li>
      <div className="local-import-file">
        <strong title={item.name}>{item.name}</strong>
        <span role="status">
          {item.status === "waiting"
            ? "Waiting to upload"
            : item.status === "uploading"
              ? item.sent === item.size
                ? "Server is verifying the upload"
                : "Uploading"
              : item.error}
        </span>
        <progress aria-label={`Upload ${item.name}`} max={item.size || 1} value={item.sent} />
        <span>
          {formatTransferBytes(item.sent)} / {formatTransferBytes(item.size)}
        </span>
      </div>
      <div className="local-import-actions">
        {item.status === "error" || item.status === "cancelled" ? (
          <button
            type="button"
            aria-label={`Retry upload ${item.name}`}
            onClick={() => imports.retry(item.id)}
          >
            Retry upload
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Cancel upload ${item.name}`}
          onClick={() => imports.cancel(item.id)}
        >
          {item.status === "error" || item.status === "cancelled" ? "Dismiss" : "Cancel upload"}
        </button>
      </div>
    </li>
  );
}
