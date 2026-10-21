import { useMemo } from "react";
import { useImagePreviewCache } from "../../hooks/useImagePreviewCache";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useLocalStorageSettings } from "../../hooks/useLocalStorageSettings";
import { usePreviewSelection } from "../../hooks/usePreviewSelection";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { useTextPreview } from "../../hooks/useTextPreview";
import { useVideoPlaybackController } from "../../hooks/useVideoPlaybackController";
import { downloadOptionsToLegacySettings } from "../../lib/downloadOptions";
import { useWorkspacePageEffects } from "./useWorkspacePageEffects";
import { useWorkspacePageState, type WorkspacePageState } from "./useWorkspacePageState";
import { useWorkspaceQueue } from "./useWorkspaceQueue";
import { buildWorkspaceRailItems } from "./workspaceRail";
import { useWorkspaceLivePreviews } from "./useWorkspaceLivePreviews";
import { useWorkspacePreviewNavigation } from "./useWorkspacePreviewNavigation";

function useWorkspaceMedia(state: WorkspacePageState) {
  const selection = usePreviewSelection({
    previewQuality: state.previewQuality,
    selectedPath: state.selectedPath,
    session: state.session,
    sortMode: state.sortMode,
  });
  const text = useTextPreview({
    selectedKind: selection.selectedKind,
    selectedNode: selection.selectedNode,
    selectedPreviewUrl: selection.selectedPreviewUrl,
    sessionId: state.session?.id || "",
  });
  const image = useImagePreviewCache({
    previewQuality: state.previewQuality,
    selectedImagePreviewUrl: selection.selectedImagePreviewUrl,
    selectedKind: selection.selectedKind,
    selectedNode: selection.selectedNode,
    sessionId: state.session?.id || "",
  });
  const video = useVideoPlaybackController({
    selectedKind: selection.selectedKind,
    selectedNode: selection.selectedNode,
    session: state.session,
  });
  return { image, selection, text, video };
}

type WorkspaceMedia = ReturnType<typeof useWorkspaceMedia>;
type WorkspaceSettings = ReturnType<typeof useLocalStorageSettings>;

function useWorkspaceLifecycle(
  state: WorkspacePageState,
  settings: WorkspaceSettings,
  media: WorkspaceMedia,
  downloadSettings: ReturnType<typeof downloadOptionsToLegacySettings>,
) {
  return useSessionLifecycle({
    activeJob: state.activeJob,
    clearImagePreviewCache: media.image.clearImagePreviewCache,
    clearTextPreviewCache: media.text.clearTextPreviewCache,
    downloadOptions: settings.downloadOptions,
    downloadSettings,
    resetSelectedImageSrc: media.image.resetSelectedImageSrc,
    resetTextPreview: media.text.resetTextPreview,
    session: state.session,
    setActiveJob: state.setActiveJob,
    setError: state.setError,
    setIsLoading: state.setIsLoading,
    setOversizePrompt: state.setOversizePrompt,
    setSelectedPath: state.setSelectedPath,
    setSession: state.setSession,
    setSlideshowOpen: state.setSlideshowOpen,
    setZipUrl: state.setZipUrl,
    zipUrl: state.zipUrl,
  });
}

function useWorkspaceKeyboard(
  state: WorkspacePageState,
  settings: WorkspaceSettings,
  media: WorkspaceMedia,
): void {
  useKeyboardShortcuts({
    currentFolderImages: media.selection.currentFolderPreviewables,
    currentImageIndex: state.activeView === "explore" ? media.selection.currentPreviewIndex : -1,
    keyboardSettings: settings.keyboardSettings,
    nextImagePath: media.selection.nextPreviewPath,
    previousImagePath: media.selection.previousPreviewPath,
    selectedKind: state.activeView === "explore" ? media.selection.selectedKind : "",
    setSelectedPath: state.setSelectedPath,
    setSlideshowOpen: state.setSlideshowOpen,
    setVideoPlaybackRate: media.video.setVideoPlaybackRate,
    setVideoVolume: media.video.setVideoVolume,
    slideshowOpen: state.slideshowOpen,
    videoRef: media.video.videoRef,
    videoShellRef: media.video.videoShellRef,
  });
}

export function useWorkspacePageController() {
  const state = useWorkspacePageState();
  const settings = useLocalStorageSettings();
  const downloadSettings = useMemo(
    () => downloadOptionsToLegacySettings(settings.downloadOptions),
    [settings.downloadOptions],
  );
  const media = useWorkspaceMedia(state);
  const lifecycle = useWorkspaceLifecycle(state, settings, media, downloadSettings);
  const queue = useWorkspaceQueue();
  useWorkspacePageEffects(state, media.selection, media.image.loadImagePreview);
  useWorkspaceKeyboard(state, settings, media);
  const livePreviews = useWorkspaceLivePreviews(queue.jobs, queue.sessions);
  const railItems = buildWorkspaceRailItems(queue.jobs, queue.sessions, livePreviews);
  const actions = useWorkspacePreviewNavigation(state, railItems);
  return {
    actions,
    downloadSettings,
    lifecycle,
    media,
    queue,
    railItems,
    settings,
    state,
  };
}

export type WorkspacePageController = ReturnType<typeof useWorkspacePageController>;
