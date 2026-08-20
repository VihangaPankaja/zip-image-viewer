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
  const { thumbnailStripExpanded: expanded } = props;
  if (props.currentFolderImageItems.length <= 1) {
    return null;
  }
  return (
    <div
      className={`thumbnail-strip-shell ${expanded ? "expanded" : "collapsed"}`}
    >
      <div className="thumbnail-strip-header">
        <div>
          <strong>Folder thumbnails</strong>
          <div className="thumbnail-strip-copy">
            {expanded
              ? `Showing all ${props.currentFolderImageItems.length} sibling images.`
              : "Showing nearby images around the current selection."}
          </div>
        </div>
        <button
          className="ghost-button"
          type="button"
          onClick={() => props.setThumbnailStripExpanded((current) => !current)}
        >
          {expanded ? "Collapse strip" : "Expand strip"}
        </button>
      </div>
      <div
        className={`thumbnail-strip ${expanded ? "expanded" : "collapsed"}`}
        role="list"
        aria-label="Folder images"
      >
        {props.visibleThumbnailItems.map((item) => (
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
    </div>
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
