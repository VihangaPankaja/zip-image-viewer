import { CustomDropdown } from "./Common/CustomDropdown";

type ExplorerNode = {
  children?: ExplorerNode[];
  extension?: string;
  modifiedAt?: number;
  name: string;
  path: string;
  size?: number;
  type: "file" | "directory";
};

export type ExplorerTablePanelProps = {
  sortedTree: ExplorerNode | null;
  session: { id?: string } | null;
  explorerRows: readonly ExplorerNode[];
  selectedPath: string;
  setSelectedPath: (value: string) => void;
  sortMode: string;
  setSortMode: (value: string) => void;
  sortOptions: Array<{ value: string; label: string }>;
  explorerColumns: {
    type: boolean;
    size: boolean;
    date: boolean;
    path: boolean;
  };
  formatDate: (value: number) => string;
  formatBytes: (value: number) => string;
};

function ExplorerPanelHeader(
  props: Pick<
    ExplorerTablePanelProps,
    | "sortedTree"
    | "session"
    | "explorerRows"
    | "sortMode"
    | "setSortMode"
    | "sortOptions"
  >,
) {
  return (
    <header className="panel-header panel-header-stackable explorer-header">
      <div className="panel-title-group explorer-title-group">
        <p className="panel-label">Explorer</p>
        <h2
          id="explorer-title"
          title={props.sortedTree?.name || "No archive loaded"}
        >
          {props.sortedTree?.name || "No archive loaded"}
        </h2>
      </div>
      {props.session ? (
        <span className="panel-chip">{props.explorerRows.length} entries</span>
      ) : null}
      <CustomDropdown
        id="sort-mode-explorer"
        label="Sort"
        value={props.sortMode}
        options={props.sortOptions}
        onChange={(value) => props.setSortMode(String(value))}
        className="toolbar-select-shell-wide explorer-sort-shell"
      />
    </header>
  );
}

function ExplorerTable(
  props: Pick<
    ExplorerTablePanelProps,
    | "explorerRows"
    | "selectedPath"
    | "setSelectedPath"
    | "explorerColumns"
    | "formatDate"
    | "formatBytes"
  >,
) {
  const { explorerColumns: columns } = props;
  return (
    <div className="explorer-table-wrap">
      <table className="explorer-table" aria-label="Archive files">
        <thead>
          <tr>
            <th scope="col">Name</th>
            {columns.type ? <th scope="col">Type</th> : null}
            {columns.size ? <th scope="col">Size</th> : null}
            {columns.date ? <th scope="col">Modified</th> : null}
            {columns.path ? <th scope="col">Path</th> : null}
          </tr>
        </thead>
        <tbody>
          {props.explorerRows.map((row) => (
            <tr key={row.path}>
              <td>
                {row.type === "file" ? (
                  <button
                    className="explorer-file-button"
                    type="button"
                    aria-current={
                      row.path === props.selectedPath ? "true" : undefined
                    }
                    aria-label={`Open ${row.name}`}
                    onClick={() => props.setSelectedPath(row.path)}
                  >
                    {row.name}
                  </button>
                ) : (
                  <span className="explorer-directory-name">{row.name}</span>
                )}
              </td>
              {columns.type ? <td>{row.type}</td> : null}
              {columns.size ? (
                <td>{props.formatBytes(row.size ?? 0)}</td>
              ) : null}
              {columns.date ? (
                <td>{props.formatDate(row.modifiedAt ?? 0)}</td>
              ) : null}
              {columns.path ? <td>{row.path}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExplorerTablePanel(props: ExplorerTablePanelProps) {
  return (
    <section className="explorer-table-panel" aria-labelledby="explorer-title">
      <ExplorerPanelHeader {...props} />
      {!props.sortedTree ? (
        <div className="empty-card">
          <strong>Explorer is ready</strong>
          <p>Add a public URL to queue an archive and list its files here.</p>
        </div>
      ) : (
        <ExplorerTable {...props} />
      )}
    </section>
  );
}
