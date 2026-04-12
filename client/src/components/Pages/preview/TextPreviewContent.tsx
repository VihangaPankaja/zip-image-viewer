import React from "react";

export function TextPreviewContent({
  selectedNode,
  formatBytes,
  formatDate,
  textPreview,
}) {
  return (
    <div className="text-preview">
      <div className="preview-toolbar">
        <span>{formatBytes(selectedNode.size)}</span>
        <span>{selectedNode.extension.toUpperCase()} preview</span>
        <span>{formatDate(selectedNode.modifiedAt)}</span>
      </div>
      <pre>{textPreview || "Loading file..."}</pre>
    </div>
  );
}
