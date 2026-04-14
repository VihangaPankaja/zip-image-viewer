import Hls from "hls.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { getVideoMimeType } from "../lib/mimeTypeSystem";
import { fetchJson } from "../services/apiClient";

type VideoNode = {
  type?: string;
  path?: string;
  extension?: string;
};

type SessionRef = {
  id?: string;
};

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
  const [videoSeekPreviewUrl, setVideoSeekPreviewUrl] = useState("");
  const [videoQualityOptions, setVideoQualityOptions] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [selectedVideoQuality, setSelectedVideoQuality] = useState("source");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const seekDebounceRef = useRef<number | null>(null);
  const videoShellRef = useRef<HTMLDivElement | null>(null);

  const selectedVideoOriginalUrl =
    selectedNode?.type === "file" && selectedKind === "video"
      ? `/api/sessions/${session?.id}/video/play?${new URLSearchParams({
          path: String(selectedNode.path || ""),
          quality: "source",
        }).toString()}`
      : "";

  const selectedVideoHlsUrl =
    selectedNode?.type === "file" && selectedKind === "video"
      ? `/api/sessions/${session?.id}/video/hls/playlist?${new URLSearchParams({
          path: String(selectedNode.path || ""),
          quality: selectedVideoQuality,
        }).toString()}`
      : "";

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || selectedKind !== "video") {
      return;
    }

    function syncState() {
      setVideoDuration(Number(videoElement.duration) || 0);
      setVideoCurrentTime(Number(videoElement.currentTime) || 0);

      const buffered = videoElement.buffered;
      if (buffered.length > 0) {
        setVideoBufferedEnd(buffered.end(buffered.length - 1));
      } else {
        setVideoBufferedEnd(0);
      }
    }

    function onPlay() {
      setVideoIsPlaying(true);
    }

    function onPause() {
      setVideoIsPlaying(false);
    }

    function onError() {
      const mediaError = videoElement.error;
      const detail =
        mediaError?.message ||
        (mediaError?.code
          ? `Playback failed (code ${mediaError.code}).`
          : "Playback failed.");
      setVideoPlaybackError(detail);
    }

    videoElement.addEventListener("timeupdate", syncState);
    videoElement.addEventListener("progress", syncState);
    videoElement.addEventListener("loadedmetadata", syncState);
    videoElement.addEventListener("play", onPlay);
    videoElement.addEventListener("pause", onPause);
    videoElement.addEventListener("error", onError);
    syncState();

    return () => {
      videoElement.removeEventListener("timeupdate", syncState);
      videoElement.removeEventListener("progress", syncState);
      videoElement.removeEventListener("loadedmetadata", syncState);
      videoElement.removeEventListener("play", onPlay);
      videoElement.removeEventListener("pause", onPause);
      videoElement.removeEventListener("error", onError);
    };
  }, [selectedKind]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || selectedKind !== "video" || !selectedNode) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const useOriginal = selectedVideoQuality === "source";
    setVideoPlaybackError("");

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!useOriginal && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: false,
        maxBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          setVideoPlaybackError(data?.details || "HLS playback failed.");
        }
      });
      hls.loadSource(selectedVideoHlsUrl);
      hls.attachMedia(videoElement);
    } else if (
      !useOriginal &&
      videoElement.canPlayType("application/vnd.apple.mpegurl")
    ) {
      videoElement.src = selectedVideoHlsUrl;
      videoElement.load();
    } else {
      videoElement.innerHTML = "";
      const source = document.createElement("source");
      source.src = selectedVideoOriginalUrl;
      source.type = getVideoMimeType(String(selectedNode.extension || ""));
      videoElement.appendChild(source);
      videoElement.load();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [
    selectedKind,
    selectedNode,
    selectedVideoHlsUrl,
    selectedVideoOriginalUrl,
    selectedVideoQuality,
  ]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || selectedKind !== "video") {
      return;
    }

    if (Math.abs((videoElement.volume || 0) - videoVolume) > 0.01) {
      videoElement.volume = videoVolume;
    }
  }, [selectedKind, videoVolume]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || selectedKind !== "video") {
      return;
    }

    if (Math.abs((videoElement.playbackRate || 1) - videoPlaybackRate) > 0.01) {
      videoElement.playbackRate = videoPlaybackRate;
    }
  }, [selectedKind, videoPlaybackRate]);

  useEffect(() => {
    if (
      selectedKind !== "video" ||
      !session?.id ||
      selectedNode?.type !== "file"
    ) {
      setVideoQualityOptions([]);
      setSelectedVideoQuality("source");
      return;
    }

    let cancelled = false;
    const path = String(selectedNode.path || "");

    async function loadQualityOptions() {
      try {
        const query = new URLSearchParams({ path });
        const payload = await fetchJson<{
          options?: Array<{ id?: string; label?: string }>;
          defaultQuality?: string;
        }>(`/api/sessions/${session.id}/video/qualities?${query.toString()}`);

        const options = Array.isArray(payload.options)
          ? payload.options.map((option) => ({
              id: String(option.id),
              label: String(option.label || option.id),
            }))
          : [];
        const selected =
          options.find((item) => item.id === payload.defaultQuality)?.id ||
          options.find((item) => item.id === "source")?.id ||
          options[0]?.id ||
          "source";

        if (!cancelled) {
          setVideoQualityOptions(options);
          setSelectedVideoQuality(selected);
        }
      } catch {
        if (!cancelled) {
          setVideoQualityOptions([{ id: "source", label: "Original" }]);
          setSelectedVideoQuality("source");
        }
      }
    }

    loadQualityOptions();
    return () => {
      cancelled = true;
    };
  }, [selectedKind, selectedNode, session]);

  useEffect(() => {
    function onFullscreenChange() {
      const shell = videoShellRef.current;
      setVideoIsFullscreen(
        Boolean(shell && document.fullscreenElement === shell),
      );
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (
      selectedKind !== "video" ||
      selectedNode?.type !== "file" ||
      !session?.id ||
      videoSeekHoverTime == null
    ) {
      setVideoSeekPreviewUrl("");
      return;
    }

    if (seekDebounceRef.current) {
      window.clearTimeout(seekDebounceRef.current);
    }

    seekDebounceRef.current = window.setTimeout(() => {
      const query = new URLSearchParams({
        path: String(selectedNode.path || ""),
        quality: selectedVideoQuality,
        time: String(videoSeekHoverTime),
        width: "260",
      });
      const url = `/api/sessions/${session.id}/video/thumbnail?${query.toString()}`;
      setVideoSeekPreviewUrl(url);
    }, 140);

    return () => {
      if (seekDebounceRef.current) {
        window.clearTimeout(seekDebounceRef.current);
      }
    };
  }, [
    session,
    selectedKind,
    selectedNode,
    selectedVideoQuality,
    videoSeekHoverTime,
  ]);

  const videoPlayedPercent = useMemo(
    () =>
      videoDuration > 0
        ? Math.max(0, Math.min(100, (videoCurrentTime / videoDuration) * 100))
        : 0,
    [videoCurrentTime, videoDuration],
  );

  const videoBufferedPercent = useMemo(
    () =>
      videoDuration > 0
        ? Math.max(0, Math.min(100, (videoBufferedEnd / videoDuration) * 100))
        : 0,
    [videoBufferedEnd, videoDuration],
  );

  function toggleVideoPlayback() {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    if (videoElement.paused) {
      videoElement.play().catch(() => {});
    } else {
      videoElement.pause();
    }
  }

  function seekVideoTo(timeSeconds: number) {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const bounded = Math.max(0, Math.min(videoDuration || 0, timeSeconds));

    if (selectedVideoQuality !== "source") {
      const hlsUrl = new URL(selectedVideoHlsUrl, window.location.origin);
      hlsUrl.searchParams.set("seekSeconds", String(bounded));

      if (hlsRef.current) {
        hlsRef.current.loadSource(hlsUrl.pathname + hlsUrl.search);
      } else if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
        videoElement.src = hlsUrl.pathname + hlsUrl.search;
        videoElement.load();
      }
    }

    videoElement.currentTime = bounded;
    setVideoCurrentTime(bounded);
  }

  function toggleVideoFullscreen() {
    const shell = videoShellRef.current;
    if (!shell) {
      return;
    }

    if (document.fullscreenElement === shell) {
      document.exitFullscreen().catch(() => {});
      return;
    }

    shell.requestFullscreen?.().catch(() => {});
  }

  return {
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
    videoSeekPreviewUrl,
    videoQualityOptions,
    selectedVideoQuality,
    setSelectedVideoQuality,
    videoPlayedPercent,
    videoBufferedPercent,
    toggleVideoPlayback,
    seekVideoTo,
    toggleVideoFullscreen,
  };
}
