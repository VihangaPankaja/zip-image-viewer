import React from "react";
import { ImagePreviewContent } from "./ImagePreviewContent";
import { TextPreviewContent } from "./TextPreviewContent";
import { VideoPreviewContent } from "./VideoPreviewContent";
import { AudioPreviewContent } from "./AudioPreviewContent";
import { BinaryPreviewContent } from "./BinaryPreviewContent";
import type {
  ImagePreviewProps,
  PreviewFileNode,
  PreviewNode,
  VideoPreviewProps,
} from "../../features/workspace/types";
import type { AudioPreviewContentProps } from "./AudioPreviewContent";
import type { TextPreviewContentProps } from "./TextPreviewContent";
import type { PreviewKind } from "../../types/preview";

export type PreviewContentProps = Omit<ImagePreviewProps, "selectedNode"> &
  Omit<VideoPreviewProps, "selectedNode"> &
  Omit<AudioPreviewContentProps, "selectedNode"> &
  Omit<TextPreviewContentProps, "selectedNode"> & {
    selectedKind: PreviewKind;
    selectedNode: PreviewNode | null;
    setExplorerModalOpen: (value: boolean) => void;
    setSlideshowOpen: (value: boolean) => void;
  };

function isPreviewFileNode(node: PreviewNode | null): node is PreviewFileNode {
  return node?.type === "file";
}

function PreviewHeader({
  selectedNode,
  selectedFile,
  selectedKind,
  selectedFileUrl,
  setExplorerModalOpen,
  setSlideshowOpen,
}: Pick<
  PreviewContentProps,
  | "selectedNode"
  | "selectedKind"
  | "selectedFileUrl"
  | "setExplorerModalOpen"
  | "setSlideshowOpen"
> & { selectedFile: PreviewFileNode | null }) {
  return (
    <div className="panel-header">
      <div className="panel-title-group">
        <p className="panel-label">Preview</p>
        <h2 title={selectedNode?.name || "Select a file"}>
          {selectedNode?.name || "Select a file"}
        </h2>
      </div>
      {selectedFile ? (
        <div className="panel-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => setExplorerModalOpen(true)}
          >
            Open explorer
          </button>
          {selectedKind !== "binary" && selectedKind !== "directory" ? (
            <button
              className="ghost-button"
              type="button"
              onClick={(event) =>
                void event.currentTarget
                  .closest<HTMLElement>(".preview-panel")
                  ?.requestFullscreen?.()
              }
            >
              Maximize preview
            </button>
          ) : null}
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
  );
}

function SelectedPreview({
  props,
  selectedFile,
}: {
  props: PreviewContentProps;
  selectedFile: PreviewFileNode;
}) {
  const {
    selectedKind,
    selectedFileUrl,
    formatBytes,
    formatDate,
    textPreview,
  } = props;
  if (selectedKind === "image") {
    return <ImagePreviewContent {...props} selectedNode={selectedFile} />;
  }
  if (selectedKind === "text") {
    return (
      <TextPreviewContent
        selectedNode={selectedFile}
        formatBytes={formatBytes}
        formatDate={formatDate}
        textPreview={textPreview}
      />
    );
  }
  if (selectedKind === "video") {
    return <VideoPreviewContent {...props} selectedNode={selectedFile} />;
  }
  if (selectedKind === "audio") {
    return (
      <AudioPreviewContent
        selectedNode={selectedFile}
        selectedFileUrl={selectedFileUrl}
        formatBytes={formatBytes}
        formatDate={formatDate}
      />
    );
  }
  return selectedKind === "binary" ? <BinaryPreviewContent /> : null;
}

export function PreviewContent(props: PreviewContentProps) {
  const selectedFile = isPreviewFileNode(props.selectedNode)
    ? props.selectedNode
    : null;

  return (
    <section className="preview-panel">
      <PreviewHeader {...props} selectedFile={selectedFile} />

      {!selectedFile ? (
        <div className="empty-card preview-empty">
          <strong>Nothing selected</strong>
          <p>
            Choose a file from the sidebar to start previewing its contents.
          </p>
        </div>
      ) : null}

      {selectedFile ? (
        <SelectedPreview props={props} selectedFile={selectedFile} />
      ) : null}
    </section>
  );
}
