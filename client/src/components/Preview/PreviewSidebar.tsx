import React from "react";
import { CustomDropdown } from "../Common/CustomDropdown";
import { TreeExplorer } from "../TreeExplorer";

export function PreviewSidebar({
  sortedTree,
  session,
  sortMode,
  setSortMode,
  sortOptions,
  selectedPath,
  setSelectedPath,
}) {
  return (
    <aside className="sidebar-panel">
      <div className="panel-header panel-header-stackable explorer-header">
        <div className="panel-title-group explorer-title-group">
          <p className="panel-label">Explorer</p>
          <h2 title={sortedTree?.name || "No archive loaded"}>
            {sortedTree?.name || "No archive loaded"}
          </h2>
        </div>
        <div className="sidebar-header-actions">
          {session ? (
            <span className="panel-chip">{session.stats.fileCount} files</span>
          ) : null}
        </div>
        <CustomDropdown
          id="sort-mode"
          label="Sort"
          value={sortMode}
          options={sortOptions}
          onChange={(value) => setSortMode(String(value))}
          className="toolbar-select-shell-wide explorer-sort-shell"
        />
      </div>

      <div className="sort-caption">
        {sortMode === "natural-tail"
          ? "Number trail mode keeps names like file 2, file 10, file 11 in number order."
          : sortMode.startsWith("date")
            ? "Date sorting uses ZIP entry modified times when the archive provides them."
            : "Sorting affects explorer order, preview arrows, thumbnails, and slideshow navigation."}
      </div>

      <div className="tree-scroll">
        {sortedTree ? (
          <TreeExplorer
            rootNode={sortedTree}
            selectedPath={selectedPath}
            onSelect={(node) => {
              if (node.type === "file") {
                setSelectedPath(node.path);
              }
            }}
          />
        ) : (
          <div className="empty-card">
            <strong>Ready to unpack</strong>
            <p>
              Load a ZIP URL to inspect folders, preview images, and move across
              image sets with arrow keys.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
