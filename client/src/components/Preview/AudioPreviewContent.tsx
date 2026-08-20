import React from "react";
import type { PreviewFileNode } from "../../features/workspace/types";

export type AudioPreviewContentProps = {
  formatBytes: (value: number) => string;
  formatDate: (value: number) => string;
  selectedFileUrl: string;
  selectedNode: PreviewFileNode;
};

export function AudioPreviewContent({
  selectedNode,
  selectedFileUrl,
  formatBytes,
  formatDate,
}: AudioPreviewContentProps) {
  return (
    <div className="preview-stage">
      <div className="preview-toolbar">
        <span>{formatBytes(selectedNode.size ?? 0)}</span>
        <span>
          {String(selectedNode.extension || "audio").toUpperCase()} stream
          preview
        </span>
        <span>{formatDate(selectedNode.modifiedAt ?? 0)}</span>
      </div>
      <div className="image-frame media-frame">
        <audio
          className="video-player"
          src={selectedFileUrl}
          controls
          preload="metadata"
        >
          Your browser cannot play this audio inline.
        </audio>
      </div>
    </div>
  );
}
