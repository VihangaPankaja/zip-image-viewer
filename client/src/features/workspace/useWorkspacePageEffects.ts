import { useEffect } from "react";
import { getFirstFilePath } from "../../lib/treeUtils";
import type { WorkspacePageState } from "./useWorkspacePageState";

type SelectionModel = {
  currentFolderImages: string[];
  currentImageIndex: number;
  flatData: { nodesByPath: ReadonlyMap<string, unknown> } | null;
  selectedKind: string;
  sortedTree: Parameters<typeof getFirstFilePath>[0];
};

export function useWorkspacePageEffects(
  state: WorkspacePageState,
  selection: SelectionModel,
  loadImagePreview: (path: string, quality: string) => Promise<string>,
): void {
  const { setSlideshowChromeHidden, slideshowOpen } = state;
  useSelectionFallback(state, selection);
  useImagePreloading(state, selection, loadImagePreview);
  useEffect(() => {
    if (!slideshowOpen) setSlideshowChromeHidden(false);
  }, [setSlideshowChromeHidden, slideshowOpen]);
}

function useSelectionFallback(
  state: WorkspacePageState,
  selection: SelectionModel,
): void {
  useEffect(() => {
    if (!selection.flatData || !selection.sortedTree) {
      return;
    }
    if (
      !state.selectedPath ||
      !selection.flatData.nodesByPath.has(state.selectedPath)
    ) {
      state.setSelectedPath(getFirstFilePath(selection.sortedTree));
    }
  }, [selection.flatData, selection.sortedTree, state]);
}

function useImagePreloading(
  state: WorkspacePageState,
  selection: SelectionModel,
  loadImagePreview: (path: string, quality: string) => Promise<string>,
): void {
  useEffect(() => {
    if (
      !state.session ||
      selection.selectedKind !== "image" ||
      selection.currentImageIndex === -1
    ) {
      return;
    }
    const images = selection.currentFolderImages;
    const index = selection.currentImageIndex;
    const targets = [
      images[index + 1] || images[0],
      images[index - 1] || images.at(-1),
      images[index + 2],
    ];
    targets.filter(Boolean).forEach((path) => {
      void loadImagePreview(path ?? "", state.previewQuality).catch(() => "");
    });
  }, [
    loadImagePreview,
    selection.currentFolderImages,
    selection.currentImageIndex,
    selection.selectedKind,
    state.previewQuality,
    state.session,
  ]);
}
