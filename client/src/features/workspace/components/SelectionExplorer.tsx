import { TreeExplorer, type TreeExplorerProps } from "../../../components/TreeExplorer";
import type { SelectionExport } from "../useSelectionExport";

export function SelectionExportTools({ selection }: { selection: SelectionExport }) {
  return (
    <div className="selection-export-tools">
      <div className="selection-export-actions">
        <button
          type="button"
          className="ghost-button compact-button"
          aria-pressed={selection.selecting}
          onClick={() => selection.setSelecting(!selection.selecting)}
        >
          {selection.selecting ? "Done selecting" : "Select files"}
        </button>
        {selection.selecting ? (
          <>
            <button
              type="button"
              className="primary-button compact-button"
              disabled={!selection.paths.size || selection.busy}
              onClick={() => void selection.download()}
            >
              {selection.busy ? "Checking selection…" : "Download selection"}
            </button>
            <button
              type="button"
              className="ghost-button compact-button"
              disabled={!selection.paths.size || selection.busy}
              onClick={selection.clear}
            >
              Clear selection
            </button>
          </>
        ) : null}
      </div>
      {selection.selecting ? (
        <p role="status">
          {[...selection.paths].filter((name) => name !== ".").length} entries selected. Select
          folders to include all their contents. Arrow keys browse; Space or Enter selects.
        </p>
      ) : null}
      {selection.message ? (
        <p role="status" className="selection-export-message">
          {selection.message}
        </p>
      ) : null}
      {selection.error ? <p role="alert">{selection.error}</p> : null}
    </div>
  );
}

export function SelectionExplorer({
  sessionId,
  exportSelection: selection,
  ...props
}: TreeExplorerProps & { sessionId?: string; exportSelection?: SelectionExport }) {
  return (
    <div className="selection-explorer">
      {sessionId && selection ? <SelectionExportTools selection={selection} /> : null}
      <TreeExplorer
        {...props}
        selection={sessionId && selection?.selecting ? selection : undefined}
      />
    </div>
  );
}
