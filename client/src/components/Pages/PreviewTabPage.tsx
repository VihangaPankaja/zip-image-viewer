import React from "react";
import { PreviewSidebar } from "../Preview/PreviewSidebar";
import { PreviewContent } from "../Preview/PreviewContent";

export function PreviewTabPage(props) {
  const {
    sortedTree,
    session,
    sortMode,
    setSortMode,
    sortOptions,
    selectedPath,
    setSelectedPath,
  } = props;

  return (
    <section className="viewer-grid">
      <PreviewSidebar
        sortedTree={sortedTree}
        session={session}
        sortMode={sortMode}
        setSortMode={setSortMode}
        sortOptions={sortOptions}
        selectedPath={selectedPath}
        setSelectedPath={setSelectedPath}
      />
      <PreviewContent {...props} />
    </section>
  );
}
