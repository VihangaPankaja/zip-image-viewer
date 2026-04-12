import React from "react";

export function AudioPreviewContent({
  selectedNode,
  selectedFileUrl,
  formatBytes,
  formatDate,
}) {
  return (
    <div className="preview-stage">
      <div className="preview-toolbar">
        <span>{formatBytes(selectedNode.size)}</span>
        <span>{selectedNode.extension.toUpperCase()} stream preview</span>
        <span>{formatDate(selectedNode.modifiedAt)}</span>
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
