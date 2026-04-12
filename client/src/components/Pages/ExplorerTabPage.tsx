import React from "react";
import { ExplorerTablePanel } from "../ExplorerTablePanel";
import { CustomDropdown } from "../Common/CustomDropdown";

export function ExplorerTabPage({
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
}) {
  return (
    <ExplorerTablePanel
      sortedTree={sortedTree}
      session={session}
      explorerRows={explorerRows}
      selectedPath={selectedPath}
      setSelectedPath={setSelectedPath}
      sortMode={sortMode}
      setSortMode={setSortMode}
      sortOptions={sortOptions}
      explorerColumns={explorerColumns}
      formatDate={formatDate}
      formatBytes={formatBytes}
      DropdownComponent={CustomDropdown}
    />
  );
}
