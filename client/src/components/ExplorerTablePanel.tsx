import React from "react";
import { TreeExplorer } from "./TreeExplorer";

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
  onUnlockArchive?: (row: any) => void;
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
  explorerColumns: _explorerColumns,
  formatDate: _formatDate,
  formatBytes: _formatBytes,
  onUnlockArchive: _onUnlockArchive,
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
          {session ? (
            <span className="panel-chip">{explorerRows.length} entries</span>
          ) : null}
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
          <p>
            Open a URL from the Download tab to list files like a file manager
            with sortable metadata.
          </p>
        </div>
      ) : (
        <div className="explorer-tree-wrap">
          <TreeExplorer
            rootNode={sortedTree}
            selectedPath={selectedPath}
            onSelect={(node) => {
              if (node?.type === "file") {
                setSelectedPath(node.path);
              }
            }}
            compact
          />
        </div>
      )}
    </section>
  );
}
