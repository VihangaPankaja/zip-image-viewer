import React from "react";
import { ImagePreviewContent } from "./ImagePreviewContent";
import { TextPreviewContent } from "./TextPreviewContent";
import { VideoPreviewContent } from "./VideoPreviewContent";
import { AudioPreviewContent } from "./AudioPreviewContent";
import { BinaryPreviewContent } from "./BinaryPreviewContent";

export function PreviewContent(props) {
  const {
    selectedNode,
    selectedKind,
    setExplorerModalOpen,
    setSlideshowOpen,
    selectedFileUrl,
    formatBytes,
    formatDate,
    textPreview,
  } = props;

  return (
    <section className="preview-panel">
      <div className="panel-header">
        <div className="panel-title-group">
          <p className="panel-label">Preview</p>
          <h2 title={selectedNode?.name || "Select a file"}>
            {selectedNode?.name || "Select a file"}
          </h2>
        </div>
        {selectedNode?.type === "file" ? (
          <div className="panel-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => setExplorerModalOpen(true)}
            >
              Open explorer
            </button>
            {selectedKind === "image" ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => setSlideshowOpen(true)}
              >
                Slideshow
              </button>
            ) : null}
            <a
              className="ghost-button inline-link"
              href={selectedFileUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open raw
            </a>
          </div>
        ) : null}
      </div>

      {!selectedNode || selectedNode.type !== "file" ? (
        <div className="empty-card preview-empty">
          <strong>Nothing selected</strong>
          <p>
            Choose a file from the sidebar to start previewing its contents.
          </p>
        </div>
      ) : null}

      {selectedNode?.type === "file" && selectedKind === "image" ? (
        <ImagePreviewContent {...props} />
      ) : null}

      {selectedNode?.type === "file" && selectedKind === "text" ? (
        <TextPreviewContent
          selectedNode={selectedNode}
          formatBytes={formatBytes}
          formatDate={formatDate}
          textPreview={textPreview}
        />
      ) : null}

      {selectedNode?.type === "file" && selectedKind === "video" ? (
        <VideoPreviewContent {...props} />
      ) : null}

      {selectedNode?.type === "file" && selectedKind === "audio" ? (
        <AudioPreviewContent
          selectedNode={selectedNode}
          selectedFileUrl={selectedFileUrl}
          formatBytes={formatBytes}
          formatDate={formatDate}
        />
      ) : null}

      {selectedNode?.type === "file" && selectedKind === "binary" ? (
        <BinaryPreviewContent />
      ) : null}
    </section>
  );
}
