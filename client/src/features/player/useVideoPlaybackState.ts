import type Hls from "hls.js";
import { useRef, useState } from "react";
import type { VideoQualityOption } from "./videoPlaybackModel";

export function useVideoPlaybackState() {
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1);
  const [videoVolume, setVideoVolume] = useState(0.9);
  const [videoPlaybackError, setVideoPlaybackError] = useState("");
  const [videoQualityOptions, setVideoQualityOptions] = useState<
    VideoQualityOption[]
  >([]);
  const [selectedVideoQuality, setSelectedVideoQuality] = useState("source");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const videoShellRef = useRef<HTMLDivElement | null>(null);

  return {
    hlsRef,
    publicState: {
      videoRef,
      videoShellRef,
      videoPlaybackRate,
      setVideoPlaybackRate,
      videoVolume,
      setVideoVolume,
      videoPlaybackError,
      videoQualityOptions,
      selectedVideoQuality,
      setSelectedVideoQuality,
    },
    setters: {
      setVideoPlaybackError,
      setVideoQualityOptions,
      setSelectedVideoQuality,
    },
  };
}
