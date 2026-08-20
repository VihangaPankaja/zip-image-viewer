import type Hls from "hls.js";
import { useEffect, useMemo } from "react";
import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";

type VideoControlsParams = {
  duration: number;
  hlsRef: MutableRefObject<Hls | null>;
  hlsUrl: string;
  selectedQuality: string;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  setFullscreen: Dispatch<SetStateAction<boolean>>;
  shellRef: RefObject<HTMLDivElement | null>;
  videoBufferedEnd: number;
  videoCurrentTime: number;
  videoRef: RefObject<HTMLVideoElement | null>;
};

export function useVideoControls({
  duration,
  hlsRef,
  hlsUrl,
  selectedQuality,
  setCurrentTime,
  setFullscreen,
  shellRef,
  videoBufferedEnd,
  videoCurrentTime,
  videoRef,
}: VideoControlsParams) {
  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(
        Boolean(
          shellRef.current && document.fullscreenElement === shellRef.current,
        ),
      );
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [setFullscreen, shellRef]);

  const videoPlayedPercent = useMemo(
    () =>
      duration > 0
        ? Math.max(0, Math.min(100, (videoCurrentTime / duration) * 100))
        : 0,
    [duration, videoCurrentTime],
  );
  const videoBufferedPercent = useMemo(
    () =>
      duration > 0
        ? Math.max(0, Math.min(100, (videoBufferedEnd / duration) * 100))
        : 0,
    [duration, videoBufferedEnd],
  );

  function toggleVideoPlayback() {
    const player = videoRef.current;
    if (player?.paused) player.play().catch(() => {});
    else player?.pause();
  }

  function seekVideoTo(timeSeconds: number) {
    const player = videoRef.current;
    if (!player) return;
    const bounded = Math.max(0, Math.min(duration || 0, timeSeconds));
    if (selectedQuality !== "source") {
      const source = new URL(hlsUrl, window.location.origin);
      source.searchParams.set("seekSeconds", String(bounded));
      if (hlsRef.current)
        hlsRef.current.loadSource(source.pathname + source.search);
      else if (player.canPlayType("application/vnd.apple.mpegurl")) {
        player.src = source.pathname + source.search;
        player.load();
      }
    }
    player.currentTime = bounded;
    setCurrentTime(bounded);
  }

  function toggleVideoFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement === shell)
      document.exitFullscreen().catch(() => {});
    else shell.requestFullscreen?.().catch(() => {});
  }

  return {
    seekVideoTo,
    toggleVideoFullscreen,
    toggleVideoPlayback,
    videoBufferedPercent,
    videoPlayedPercent,
  };
}
