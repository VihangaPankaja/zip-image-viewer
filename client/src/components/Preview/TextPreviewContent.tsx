import React from "react";
import type { PreviewFileNode } from "../../features/workspace/types";

export type TextPreviewContentProps = {
  formatBytes: (value: number) => string;
  formatDate: (value: number) => string;
  selectedNode: PreviewFileNode;
  textPreview: string;
};

export function TextPreviewContent({
  selectedNode,
  formatBytes,
  formatDate,
  textPreview,
}: TextPreviewContentProps) {
  return (
    <div className="text-preview">
      <div className="preview-toolbar">
        <span>{formatBytes(selectedNode.size ?? 0)}</span>
        <span>
          {String(selectedNode.extension || "text").toUpperCase()} preview
        </span>
        <span>{formatDate(selectedNode.modifiedAt ?? 0)}</span>
      </div>
      <pre>{textPreview || "Loading file..."}</pre>
    </div>
  );
}
