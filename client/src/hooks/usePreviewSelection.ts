import { useMemo } from "react";
import { STRIP_THUMB_SIZE } from "../lib/appConstants";
import { getThumbnailWindow, getWrappedPath } from "../lib/archiveUiUtils";
import { buildFileUrl } from "../lib/fileUrl";
import { classifyNodeKind } from "../lib/mimeTypeSystem";
import { cloneAndSortTree, compareNodes, flattenTree } from "../lib/treeUtils";

type PreviewTreeNode = {
  type: "file" | "directory";
  path: string;
  name: string;
  modifiedAt?: number;
  size?: number;
  extension?: string;
  parentPath?: string;
  children?: PreviewTreeNode[];
  [key: string]: unknown;
};

type SessionSnapshot = {
  id?: string;
  tree?: PreviewTreeNode;
  [key: string]: unknown;
};

type UsePreviewSelectionParams = {
  session: SessionSnapshot | null;
  sortMode: string;
  selectedPath: string;
  previewQuality: string;
  thumbnailStripExpanded: boolean;
};

export function usePreviewSelection({
  session,
  sortMode,
  selectedPath,
  previewQuality,
  thumbnailStripExpanded,
}: UsePreviewSelectionParams) {
  const sortedTree = useMemo(() => {
    if (!session?.tree) {
      return null;
    }

    return cloneAndSortTree(session.tree, sortMode);
  }, [session, sortMode]);

  const flatData = useMemo(
    () => (sortedTree ? flattenTree(sortedTree) : null),
    [sortedTree],
  );

  const selectedNode = flatData?.nodesByPath.get(selectedPath) || null;
  const selectedKind = classifyNodeKind(selectedNode);

  const currentFolderImages = useMemo(() => {
    if (!selectedNode) {
      return [];
    }

    return flatData?.folderImages.get(selectedNode.parentPath) || [];
  }, [flatData, selectedNode]);

  const currentImageIndex = selectedNode
    ? currentFolderImages.indexOf(selectedNode.path)
    : -1;

  const selectedFileUrl =
    session && selectedNode && selectedNode.type === "file"
      ? buildFileUrl(session.id, selectedNode.path)
      : "";

  const selectedImagePreviewUrl =
    session &&
    selectedNode &&
    selectedNode.type === "file" &&
    selectedKind === "image"
      ? buildFileUrl(session.id, selectedNode.path, {
          imagePreview: true,
          quality: previewQuality,
        })
      : "";

  const selectedPreviewUrl =
    session && selectedNode && selectedNode.type === "file"
      ? buildFileUrl(session.id, selectedNode.path, { previewText: true })
      : "";

  const currentFolderImageItems = currentFolderImages.map((imagePath) => ({
    path: imagePath,
    name:
      flatData?.nodesByPath.get(imagePath)?.name ||
      imagePath.split("/").at(-1) ||
      imagePath,
    url: buildFileUrl(session?.id, imagePath),
    previewUrl: buildFileUrl(session?.id, imagePath, {
      imagePreview: true,
      quality: previewQuality,
    }),
    thumbnailUrl: buildFileUrl(session?.id, imagePath, {
      thumbnail: true,
      size: STRIP_THUMB_SIZE,
    }),
  }));

  const visibleThumbnailItems = thumbnailStripExpanded
    ? currentFolderImageItems
    : getThumbnailWindow(currentFolderImageItems, selectedPath, 2);

  const previousImagePath = getWrappedPath(
    currentFolderImages,
    currentImageIndex,
    -1,
  );

  const nextImagePath = getWrappedPath(
    currentFolderImages,
    currentImageIndex,
    1,
  );

  const previousImageName =
    flatData?.nodesByPath.get(previousImagePath)?.name || "";
  const nextImageName = flatData?.nodesByPath.get(nextImagePath)?.name || "";

  const explorerRows = useMemo(() => {
    if (!flatData || !sortedTree) {
      return [];
    }

    return Array.from(flatData.nodesByPath.values())
      .filter((node) => node.path !== sortedTree.path)
      .sort((left, right) => compareNodes(left, right, sortMode));
  }, [flatData, sortedTree, sortMode]);

  return {
    sortedTree,
    flatData,
    selectedNode,
    selectedKind,
    currentFolderImages,
    currentImageIndex,
    selectedFileUrl,
    selectedImagePreviewUrl,
    selectedPreviewUrl,
    currentFolderImageItems,
    visibleThumbnailItems,
    previousImagePath,
    nextImagePath,
    previousImageName,
    nextImageName,
    explorerRows,
  };
}
