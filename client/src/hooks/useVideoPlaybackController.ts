import { useEffect, useState } from "react";
import { buildVideoPlaybackUrls } from "../features/player/videoPlaybackModel";
import { useVideoEventSync } from "../features/player/useVideoEventSync";
import { useVideoPlaybackState } from "../features/player/useVideoPlaybackState";
import { useVideoPreferences } from "../features/player/useVideoPreferences";
import { useVideoQualities } from "../features/player/useVideoQualities";
import { useVideoSource } from "../features/player/useVideoSource";
import { fetchJson } from "../services/apiClient";

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

type VideoHlsStatus = {
  status: string;
  renditions: {
    quality: string;
    status: string;
    availableSegments?: number;
    expectedSegments?: number;
    encoderWaitMs?: number;
  }[];
};

function useVideoHlsStatus(
  selectedKind: string,
  quality: string,
  sessionId?: string,
  path?: string,
) {
  const [status, setStatus] = useState<VideoHlsStatus | null>(null);
  useEffect(() => {
    if (
      selectedKind !== "video" ||
      quality === "source" ||
      !sessionId ||
      !path
    ) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    const url = `/api/sessions/${sessionId}/video/hls/status?${new URLSearchParams({ path })}`;
    const refresh = () => {
      void fetchJson<VideoHlsStatus>(url).then(
        (result) => {
          if (!cancelled) setStatus(result);
        },
        () => {
          if (!cancelled) setStatus(null);
        },
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedKind, quality, sessionId, path]);
  return status;
}

export function useVideoPlaybackController({
  session,
  selectedNode,
  selectedKind,
}: UseVideoPlaybackControllerParams) {
  const state = useVideoPlaybackState();
  const playback = state.publicState;
  const videoHlsStatus = useVideoHlsStatus(
    selectedKind,
    playback.selectedVideoQuality,
    session?.id,
    selectedNode?.path,
  );
  const urls = buildVideoPlaybackUrls({
    selectedKind,
    selectedNode,
    sessionId: session?.id,
  });
  useVideoEventSync({
    selectedKind,
    videoRef: playback.videoRef,
    setPlaybackError: state.setters.setVideoPlaybackError,
    setPlaybackStatus: state.setters.setVideoPlaybackStatus,
  });
  useVideoSource({
    extension: selectedNode?.extension,
    hlsRef: state.hlsRef,
    hlsUrl: urls.hlsUrl,
    originalUrl: urls.originalUrl,
    selectedKind,
    selectedQuality: playback.selectedVideoQuality,
    setVideoHeight: state.setters.setVideoHeight,
    setPlaybackError: state.setters.setVideoPlaybackError,
    setPlaybackStatus: state.setters.setVideoPlaybackStatus,
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
  const retryVideoPlayback = () => {
    state.setters.setVideoPlaybackError("");
    state.setters.setVideoPlaybackStatus("loading");
    if (state.hlsRef.current) {
      if (
        playback.videoPlaybackError ===
        "This browser cannot decode this stream."
      ) {
        state.hlsRef.current.recoverMediaError();
      } else {
        state.hlsRef.current.startLoad(-1);
      }
    } else {
      playback.videoRef.current?.load();
    }
  };
  return {
    ...playback,
    hlsRef: state.hlsRef,
    videoHlsStatus,
    retryVideoPlayback,
  };
}
