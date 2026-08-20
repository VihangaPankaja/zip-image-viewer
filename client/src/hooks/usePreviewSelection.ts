import { useMemo } from "react";
import { STRIP_THUMB_SIZE } from "../lib/appConstants";
import { getWrappedPath } from "../lib/archiveUiUtils";
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
};

type FlatPreviewData = ReturnType<typeof flattenTree>;

function buildPreviewUrls(
  sessionId: string,
  node: PreviewTreeNode | null,
  selectedKind: string,
  quality: string,
) {
  if (!node || node.type !== "file") {
    return {
      selectedFileUrl: "",
      selectedImagePreviewUrl: "",
      selectedPreviewUrl: "",
    };
  }
  return {
    selectedFileUrl: buildFileUrl(sessionId, node.path),
    selectedImagePreviewUrl:
      selectedKind === "image"
        ? buildFileUrl(sessionId, node.path, { imagePreview: true, quality })
        : "",
    selectedPreviewUrl: buildFileUrl(sessionId, node.path, {
      previewText: true,
    }),
  };
}

function buildImageItems(
  paths: readonly string[],
  flatData: FlatPreviewData | null,
  sessionId: string,
  quality: string,
) {
  return paths.map((path) => ({
    path,
    name:
      flatData?.nodesByPath.get(path)?.name || path.split("/").at(-1) || path,
    url: buildFileUrl(sessionId, path),
    previewUrl: buildFileUrl(sessionId, path, {
      imagePreview: true,
      quality,
    }),
    thumbnailUrl: buildFileUrl(sessionId, path, {
      thumbnail: true,
      size: STRIP_THUMB_SIZE,
    }),
  }));
}

function buildImageNavigation(
  paths: string[],
  currentIndex: number,
  flatData: FlatPreviewData | null,
) {
  const previousImagePath = getWrappedPath(paths, currentIndex, -1);
  const nextImagePath = getWrappedPath(paths, currentIndex, 1);
  return {
    previousImagePath,
    nextImagePath,
    previousImageName: flatData?.nodesByPath.get(previousImagePath)?.name || "",
    nextImageName: flatData?.nodesByPath.get(nextImagePath)?.name || "",
  };
}

export function usePreviewSelection({
  session,
  sortMode,
  selectedPath,
  previewQuality,
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

  const currentFolderImages = selectedNode
    ? flatData?.folderImages.get(selectedNode.parentPath || "") || []
    : [];

  const currentImageIndex = selectedNode
    ? currentFolderImages.indexOf(selectedNode.path)
    : -1;

  const urls = buildPreviewUrls(
    session?.id || "",
    selectedNode,
    selectedKind,
    previewQuality,
  );
  const currentFolderImageItems = buildImageItems(
    currentFolderImages,
    flatData,
    session?.id || "",
    previewQuality,
  );

  const navigation = buildImageNavigation(
    currentFolderImages,
    currentImageIndex,
    flatData,
  );

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
    ...urls,
    currentFolderImageItems,
    ...navigation,
    explorerRows,
  };
}
