import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

type VideoEventSyncParams = {
  selectedKind: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  setDuration: Dispatch<SetStateAction<number>>;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  setBufferedEnd: Dispatch<SetStateAction<number>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPlaybackError: Dispatch<SetStateAction<string>>;
};

export function useVideoEventSync(params: VideoEventSyncParams) {
  const {
    selectedKind,
    videoRef,
    setDuration,
    setCurrentTime,
    setBufferedEnd,
    setIsPlaying,
    setPlaybackError,
  } = params;
  useEffect(() => {
    const player = videoRef.current;
    if (!player || selectedKind !== "video") return;

    const syncState = () => {
      setDuration(Number(player.duration) || 0);
      setCurrentTime(Number(player.currentTime) || 0);
      const lastRange = player.buffered.length - 1;
      setBufferedEnd(lastRange >= 0 ? player.buffered.end(lastRange) : 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onError = () => {
      const mediaError = player.error;
      const detail =
        mediaError?.message ||
        (mediaError?.code
          ? `Playback failed (code ${mediaError.code}).`
          : "Playback failed.");
      setPlaybackError(detail);
    };

    player.addEventListener("timeupdate", syncState);
    player.addEventListener("progress", syncState);
    player.addEventListener("loadedmetadata", syncState);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    player.addEventListener("error", onError);
    syncState();
    return () => {
      player.removeEventListener("timeupdate", syncState);
      player.removeEventListener("progress", syncState);
      player.removeEventListener("loadedmetadata", syncState);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      player.removeEventListener("error", onError);
    };
  }, [
    selectedKind,
    setBufferedEnd,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setPlaybackError,
    videoRef,
  ]);
}
