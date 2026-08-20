import { buildVideoPlaybackUrls } from "../features/player/videoPlaybackModel";
import { useVideoEventSync } from "../features/player/useVideoEventSync";
import { useVideoPlaybackState } from "../features/player/useVideoPlaybackState";
import { useVideoPreferences } from "../features/player/useVideoPreferences";
import { useVideoQualities } from "../features/player/useVideoQualities";
import { useVideoSource } from "../features/player/useVideoSource";

type VideoNode = {
  type?: string;
  path?: string;
  extension?: string;
};

type SessionRef = { id?: string };
type UseVideoPlaybackControllerParams = {
  session: SessionRef | null;
  selectedNode: VideoNode | null;
  selectedKind: string;
};

export function useVideoPlaybackController({
  session,
  selectedNode,
  selectedKind,
}: UseVideoPlaybackControllerParams) {
  const state = useVideoPlaybackState();
  const playback = state.publicState;
  const urls = buildVideoPlaybackUrls({
    quality: playback.selectedVideoQuality,
    selectedKind,
    selectedNode,
    sessionId: session?.id,
  });
  useVideoEventSync({
    selectedKind,
    videoRef: playback.videoRef,
    setPlaybackError: state.setters.setVideoPlaybackError,
  });
  useVideoSource({
    extension: selectedNode?.extension,
    hlsRef: state.hlsRef,
    hlsUrl: urls.hlsUrl,
    originalUrl: urls.originalUrl,
    selectedKind,
    selectedNode,
    selectedQuality: playback.selectedVideoQuality,
    setPlaybackError: state.setters.setVideoPlaybackError,
    videoRef: playback.videoRef,
  });
  useVideoPreferences({
    playbackRate: playback.videoPlaybackRate,
    selectedKind,
    videoRef: playback.videoRef,
    volume: playback.videoVolume,
  });
  useVideoQualities({
    path: selectedNode?.path,
    selectedKind,
    sessionId: session?.id,
    isFile: selectedNode?.type === "file",
    setOptions: state.setters.setVideoQualityOptions,
    setSelectedQuality: state.setters.setSelectedVideoQuality,
  });
  return playback;
}
