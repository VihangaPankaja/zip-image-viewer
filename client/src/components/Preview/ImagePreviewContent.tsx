import React from "react";
import { CustomDropdown } from "../Common/CustomDropdown";

export function ImagePreviewContent({
  selectedNode,
  formatBytes,
  currentImageIndex,
  currentFolderImages,
  previewQuality,
  previewQualityOptions,
  setPreviewQuality,
  formatDate,
  selectedImageSrc,
  selectedImagePreviewUrl,
  currentFolderImageItems,
  thumbnailStripExpanded,
  setThumbnailStripExpanded,
  visibleThumbnailItems,
  selectedPath,
  setSelectedPath,
}) {
  return (
    <div className="preview-stage">
      <div className="preview-toolbar">
        <span>{formatBytes(selectedNode.size)}</span>
        <span>
          {currentImageIndex >= 0
            ? `${currentImageIndex + 1} / ${currentFolderImages.length} in folder`
            : "Single image"}
        </span>
        <CustomDropdown
          id="preview-quality"
          label="Preview quality"
          value={previewQuality}
          options={previewQualityOptions}
          onChange={(value) => setPreviewQuality(String(value))}
        />
        <span>{formatDate(selectedNode.modifiedAt)}</span>
      </div>
      <div className="image-frame">
        <img
          src={selectedImageSrc || selectedImagePreviewUrl}
          alt={selectedNode.name}
        />
      </div>
      {currentFolderImageItems.length > 1 ? (
        <div
          className={`thumbnail-strip-shell ${thumbnailStripExpanded ? "expanded" : "collapsed"}`}
        >
          <div className="thumbnail-strip-header">
            <div>
              <strong>Folder thumbnails</strong>
              <div className="thumbnail-strip-copy">
                {thumbnailStripExpanded
                  ? `Showing all ${currentFolderImageItems.length} sibling images.`
                  : "Showing nearby images around the current selection."}
              </div>
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={() =>
                setThumbnailStripExpanded((current: boolean) => !current)
              }
            >
              {thumbnailStripExpanded ? "Collapse strip" : "Expand strip"}
            </button>
          </div>
          <div
            className={`thumbnail-strip ${thumbnailStripExpanded ? "expanded" : "collapsed"}`}
            role="list"
            aria-label="Folder images"
          >
            {visibleThumbnailItems.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`thumbnail-card ${item.path === selectedPath ? "active" : ""}`}
                onClick={() => setSelectedPath(item.path)}
              >
                <img src={item.thumbnailUrl} alt={item.name} loading="lazy" />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="navigation-hint">
        Use left and right arrow keys to move through sibling images in the
        active sort order.
      </div>
    </div>
  );
}
