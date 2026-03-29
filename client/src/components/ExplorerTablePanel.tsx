/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any */

type ExplorerTablePanelProps = {
  sortedTree: any;
  session: any;
  explorerRows: any[];
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
  DropdownComponent: any;
};

export function ExplorerTablePanel({
  sortedTree,
  session,
  explorerRows,
  selectedPath,
  setSelectedPath,
  sortMode,
  setSortMode,
  sortOptions,
  explorerColumns,
  formatDate,
  formatBytes,
  DropdownComponent,
}: ExplorerTablePanelProps) {
  return (
    <section className="explorer-table-panel">
      <div className="panel-header panel-header-stackable explorer-header">
        <div className="panel-title-group explorer-title-group">
          <p className="panel-label">Explorer</p>
          <h2 title={sortedTree?.name || "No archive loaded"}>
            {sortedTree?.name || "No archive loaded"}
          </h2>
        </div>
        <div className="sidebar-header-actions">
          {session ? <span className="panel-chip">{explorerRows.length} entries</span> : null}
        </div>
        <DropdownComponent
          id="sort-mode-explorer"
          label="Sort"
          value={sortMode}
          options={sortOptions}
          onChange={setSortMode}
          className="toolbar-select-shell-wide explorer-sort-shell"
        />
      </div>

      {!sortedTree ? (
        <div className="empty-card">
          <strong>Explorer is ready</strong>
          <p>Open a URL from the Download tab to list files like a file manager with sortable metadata.</p>
        </div>
      ) : (
        <div className="explorer-table-wrap">
          <table className="explorer-table">
            <thead>
              <tr>
                <th>Name</th>
                {explorerColumns.type ? <th>Type</th> : null}
                {explorerColumns.size ? <th>Size</th> : null}
                {explorerColumns.date ? <th>Modified</th> : null}
                {explorerColumns.path ? <th>Path</th> : null}
              </tr>
            </thead>
            <tbody>
              {explorerRows.map((row) => (
                <tr
                  key={row.path}
                  className={row.path === selectedPath ? "active" : ""}
                  onClick={() => {
                    if (row.type === "file") {
                      setSelectedPath(row.path);
                    }
                  }}
                >
                  <td>{row.name}</td>
                  {explorerColumns.type ? <td>{row.type === "directory" ? "Folder" : row.extension || "file"}</td> : null}
                  {explorerColumns.size ? <td>{row.type === "directory" ? "--" : formatBytes(row.size)}</td> : null}
                  {explorerColumns.date ? <td>{formatDate(row.modifiedAt)}</td> : null}
                  {explorerColumns.path ? <td>{row.path}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
