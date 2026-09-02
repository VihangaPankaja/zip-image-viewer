import { useCallback, useMemo } from "react";
import { useImagePreviewCache } from "../../hooks/useImagePreviewCache";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useLocalStorageSettings } from "../../hooks/useLocalStorageSettings";
import { usePreviewSelection } from "../../hooks/usePreviewSelection";
import { useSessionLifecycle } from "../../hooks/useSessionLifecycle";
import { useTextPreview } from "../../hooks/useTextPreview";
import { useVideoPlaybackController } from "../../hooks/useVideoPlaybackController";
import { downloadOptionsToLegacySettings } from "../../lib/downloadOptions";
import { useWorkspacePageEffects } from "./useWorkspacePageEffects";
import {
  useWorkspacePageState,
  type WorkspacePageState,
} from "./useWorkspacePageState";
import { useWorkspaceQueue } from "./useWorkspaceQueue";
import { buildWorkspaceProgress } from "./workspaceProgress";
import { buildWorkspaceRailItems } from "./workspaceRail";
import { sessionPayloadSchema } from "./sessionSchemas";

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

type WorkspaceQueue = ReturnType<typeof useWorkspaceQueue>;

function useWorkspaceActions(state: WorkspacePageState, queue: WorkspaceQueue) {
  const openSession = useCallback(
    async (sessionId: string) => {
      if (
        sessionId === state.session?.id ||
        !queue.sessions.some((item) => item.id === sessionId)
      )
        return;
      const response = await fetch(`/api/sessions/${sessionId}/tree`);
      if (!response.ok) {
        state.setError("That session is not ready to browse yet.");
        return;
      }
      const parsed = sessionPayloadSchema.safeParse(await response.json());
      if (!parsed.success) {
        state.setError("That session returned invalid data.");
        return;
      }
      state.setSession(parsed.data);
      state.setSelectedPath(
        parsed.data.firstFilePath || parsed.data.tree?.path || "",
      );
      state.setError("");
      state.setActiveView("explore");
    },
    [queue.sessions, state],
  );
  return { openSession };
}

function useWorkspaceKeyboard(
  state: WorkspacePageState,
  settings: WorkspaceSettings,
  media: WorkspaceMedia,
): void {
  useKeyboardShortcuts({
    currentFolderImages: media.selection.currentFolderPreviewables,
    currentImageIndex: media.selection.currentPreviewIndex,
    keyboardSettings: settings.keyboardSettings,
    nextImagePath: media.selection.nextPreviewPath,
    previousImagePath: media.selection.previousPreviewPath,
    selectedKind: media.selection.selectedKind,
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
  const lifecycle = useWorkspaceLifecycle(
    state,
    settings,
    media,
    downloadSettings,
  );
  const queue = useWorkspaceQueue();
  const actions = useWorkspaceActions(state, queue);
  useWorkspacePageEffects(state, media.selection, media.image.loadImagePreview);
  useWorkspaceKeyboard(state, settings, media);
  const progress = buildWorkspaceProgress(state.activeJob);
  const railItems = useMemo(
    () =>
      buildWorkspaceRailItems(
        queue.jobs,
        queue.sessions,
        state.activeJob,
        state.session,
        progress,
      ),
    [progress, queue.jobs, queue.sessions, state.activeJob, state.session],
  );
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

export type WorkspacePageController = ReturnType<
  typeof useWorkspacePageController
>;
