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
  useSelectionFallback(state, selection);
  useImagePreloading(state, selection, loadImagePreview);
  useSlideshowBodyLock(state.slideshowOpen, state.setSlideshowChromeHidden);
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

function useSlideshowBodyLock(
  slideshowOpen: boolean,
  setChromeHidden: (value: boolean) => void,
): void {
  useEffect(() => {
    if (!slideshowOpen) {
      setChromeHidden(false);
      return undefined;
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [setChromeHidden, slideshowOpen]);
}
