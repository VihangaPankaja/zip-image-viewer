import React from "react";
import type { PreviewFileNode } from "../../features/workspace/types";
import { AudioPlayerControls } from "../../features/player/AudioPlayerControls";

export type AudioPreviewContentProps = {
  formatBytes: (value: number) => string;
  formatDate: (value: number) => string;
  selectedNode: PreviewFileNode;
};

export function AudioPreviewContent({
  selectedNode,
  formatBytes,
  formatDate,
}: AudioPreviewContentProps) {
  return (
    <div className="preview-stage">
      <div className="preview-toolbar">
        <span>{formatBytes(selectedNode.size ?? 0)}</span>
        <span>{(selectedNode.extension || "audio").toUpperCase()} stream preview</span>
        <span>{formatDate(selectedNode.modifiedAt ?? 0)}</span>
      </div>
      <AudioPlayerControls />
    </div>
  );
}
