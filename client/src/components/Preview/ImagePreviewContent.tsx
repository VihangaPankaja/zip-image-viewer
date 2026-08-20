import React from "react";
import { CustomDropdown } from "../Common/CustomDropdown";
import type { ImagePreviewProps } from "../../features/workspace/types";

function ImagePreviewToolbar(props: ImagePreviewProps) {
  return (
    <div className="preview-toolbar">
      <span>{props.formatBytes(props.selectedNode.size ?? 0)}</span>
      <span>
        {props.currentImageIndex >= 0
          ? `${props.currentImageIndex + 1} / ${props.currentFolderImages.length} in folder`
          : "Single image"}
      </span>
      <CustomDropdown
        id="preview-quality"
        label="Preview quality"
        value={props.previewQuality}
        options={props.previewQualityOptions}
        onChange={(value) => props.setPreviewQuality(String(value))}
      />
      <span>{props.formatDate(props.selectedNode.modifiedAt ?? 0)}</span>
    </div>
  );
}

function ThumbnailStrip(props: ImagePreviewProps) {
  if (props.currentFolderImageItems.length <= 1) {
    return null;
  }
  return (
    <details className="thumbnail-strip-shell">
      <summary className="thumbnail-strip-header">
        <span>
          <strong>Folder thumbnails</strong>
          <span className="thumbnail-strip-copy">
            {props.currentFolderImageItems.length} sibling images
          </span>
        </span>
      </summary>
      <div className="thumbnail-strip" role="list" aria-label="Folder images">
        {props.currentFolderImageItems.map((item) => (
          <button
            key={item.path}
            type="button"
            className={`thumbnail-card ${item.path === props.selectedPath ? "active" : ""}`}
            onClick={() => props.setSelectedPath(item.path)}
          >
            <img src={item.thumbnailUrl} alt={item.name} loading="lazy" />
            <span>{item.name}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

export function ImagePreviewContent(props: ImagePreviewProps) {
  return (
    <div className="preview-stage">
      <ImagePreviewToolbar {...props} />
      <div className="image-frame">
        <img
          src={props.selectedImageSrc || props.selectedImagePreviewUrl}
          alt={props.selectedNode.name}
        />
      </div>
      <ThumbnailStrip {...props} />
      <div className="navigation-hint">
        Use left and right arrow keys to move through sibling images in the
        active sort order.
      </div>
    </div>
  );
}
