import { useCallback, useState, type RefObject } from "react";
import type Hls from "hls.js";

export type VideoAudioOption = { id: string; label: string };
export type VideoAudioMode = "hls" | "native" | "unavailable";
type NativeAudioTrack = { label: string; language: string; enabled: boolean };
type NativeAudioTracks = ArrayLike<NativeAudioTrack> & EventTarget;
type NativeAudioVideo = HTMLVideoElement & { audioTracks?: NativeAudioTracks };

function nativeTracks(player: HTMLVideoElement) {
  return (player as NativeAudioVideo).audioTracks;
}

function audioOptions(
  tracks: ArrayLike<{
    name?: string;
    label?: string;
    lang?: string;
    language?: string;
  }>,
) {
  return Array.from(tracks, (track, index) => ({
    id: String(index),
    label: track.name || track.label || track.lang || track.language || `Audio ${index + 1}`,
  }));
}

export function useVideoAudioTracks(
  hlsRef: RefObject<Hls | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
) {
  const [videoAudioTracks, setTracks] = useState<VideoAudioOption[]>([]);
  const [selectedVideoAudioTrack, setSelected] = useState("");
  const [videoAudioMode, setMode] = useState<VideoAudioMode>("unavailable");
  const resetAudioTracks = useCallback(() => {
    setTracks([]);
    setSelected("");
    setMode("unavailable");
  }, []);
  const updateHlsAudioTracks = useCallback((hls: Hls) => {
    setMode("hls");
    setTracks(audioOptions(hls.audioTracks));
    setSelected(hls.audioTrack >= 0 ? String(hls.audioTrack) : "");
  }, []);
  const updateSelectedAudioTrack = useCallback((id: number) => setSelected(String(id)), []);
  const bindNativeAudioTracks = useCallback(
    (player: HTMLVideoElement) => {
      const tracks = nativeTracks(player);
      if (!tracks || typeof tracks.addEventListener !== "function") return () => {};
      const update = () => {
        if (hlsRef.current) return;
        setMode("native");
        const choices = Array.from(tracks);
        setTracks(audioOptions(choices));
        const selected = choices.findIndex((track) => track.enabled);
        setSelected(selected >= 0 ? String(selected) : "");
      };
      update();
      for (const event of ["addtrack", "removetrack", "change"])
        tracks.addEventListener(event, update);
      player.addEventListener("loadedmetadata", update);
      return () => {
        for (const event of ["addtrack", "removetrack", "change"])
          tracks.removeEventListener(event, update);
        player.removeEventListener("loadedmetadata", update);
      };
    },
    [hlsRef],
  );
  const setSelectedVideoAudioTrack = (id: string) => {
    if (!/^\d+$/.test(id)) return;
    const index = Number(id);
    const hls = hlsRef.current;
    if (hls) {
      if (hls.audioTracks[index]) hls.audioTrack = index;
      return;
    }
    const player = videoRef.current;
    const tracks = player && nativeTracks(player);
    if (!tracks?.[index]) return;
    Array.from(tracks).forEach((track, i) => {
      track.enabled = i === index;
    });
    setSelected(id);
  };
  return {
    videoAudioTracks,
    selectedVideoAudioTrack,
    videoAudioMode,
    setSelectedVideoAudioTrack,
    resetAudioTracks,
    updateHlsAudioTracks,
    updateSelectedAudioTrack,
    bindNativeAudioTracks,
  };
}
