import { useEffect, type RefObject } from "react";

type VideoPreferencesParams = {
  playbackRate: number;
  selectedKind: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  volume: number;
};

export function useVideoPreferences({
  playbackRate,
  selectedKind,
  videoRef,
  volume,
}: VideoPreferencesParams) {
  useEffect(() => {
    const player = videoRef.current;
    if (!player || selectedKind !== "video") return;
    if (Math.abs((player.volume || 0) - volume) > 0.01) player.volume = volume;
  }, [selectedKind, videoRef, volume]);

  useEffect(() => {
    const player = videoRef.current;
    if (!player || selectedKind !== "video") return;
    if (Math.abs((player.playbackRate || 1) - playbackRate) > 0.01) {
      player.playbackRate = playbackRate;
    }
  }, [playbackRate, selectedKind, videoRef]);
}
