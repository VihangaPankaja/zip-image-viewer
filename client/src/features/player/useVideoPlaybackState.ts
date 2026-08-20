import type Hls from "hls.js";
import { useRef, useState } from "react";
import type { VideoQualityOption } from "./videoPlaybackModel";

export function useVideoPlaybackState() {
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1);
  const [videoVolume, setVideoVolume] = useState(0.9);
  const [videoPlaybackError, setVideoPlaybackError] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoBufferedEnd, setVideoBufferedEnd] = useState(0);
  const [videoIsPlaying, setVideoIsPlaying] = useState(false);
  const [videoIsFullscreen, setVideoIsFullscreen] = useState(false);
  const [videoSeekHoverTime, setVideoSeekHoverTime] = useState<number | null>(
    null,
  );
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
      videoDuration,
      videoCurrentTime,
      setVideoCurrentTime,
      videoBufferedEnd,
      videoIsPlaying,
      videoIsFullscreen,
      videoSeekHoverTime,
      setVideoSeekHoverTime,
      videoQualityOptions,
      selectedVideoQuality,
      setSelectedVideoQuality,
    },
    setters: {
      setVideoPlaybackError,
      setVideoDuration,
      setVideoCurrentTime,
      setVideoBufferedEnd,
      setVideoIsPlaying,
      setVideoIsFullscreen,
      setVideoQualityOptions,
      setSelectedVideoQuality,
    },
  };
}
