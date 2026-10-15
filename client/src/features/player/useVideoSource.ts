import type Hls from "hls.js";
import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { getVideoMimeType } from "../../lib/mimeTypeSystem";
import { useVideoAudioTracks } from "./useVideoAudioTracks";
import {
  createAdaptiveHlsConfig,
  loadHlsModule,
  resolveManualLevel,
} from "./adaptiveQuality";

type VideoSourceParams = {
  extension?: string;
  hlsRef: RefObject<Hls | null>;
  hlsUrl: string;
  originalUrl: string;
  selectedKind: string;
  selectedQuality: string;
  setPlaybackError: Dispatch<SetStateAction<string>>;
  setPlaybackStatus: Dispatch<
    SetStateAction<"loading" | "buffering" | "ready">
  >;
  setVideoHeight: Dispatch<SetStateAction<number | null>>;
  videoRef: RefObject<HTMLVideoElement | null>;
};

type AudioBindings = Pick<
  ReturnType<typeof useVideoAudioTracks>,
  | "resetAudioTracks"
  | "updateHlsAudioTracks"
  | "updateSelectedAudioTrack"
  | "bindNativeAudioTracks"
>;

type AdaptiveSourceParams = Pick<
  VideoSourceParams,
  "hlsRef" | "hlsUrl" | "setPlaybackError" | "setVideoHeight"
> &
  Pick<AudioBindings, "updateHlsAudioTracks" | "updateSelectedAudioTrack">;

function destroyHls(hlsRef: RefObject<Hls | null>) {
  hlsRef.current?.destroy();
  hlsRef.current = null;
}

function resetVideoSource(player: HTMLVideoElement) {
  player.pause();
  player.removeAttribute("src");
  player.querySelectorAll("source").forEach((source) => source.remove());
  player.load();
}

function attachOriginalSource(
  player: HTMLVideoElement,
  originalUrl: string,
  extension?: string,
) {
  player.querySelectorAll("source").forEach((source) => source.remove());
  player.removeAttribute("src");
  const source = document.createElement("source");
  source.src = originalUrl;
  source.type = getVideoMimeType(extension ?? "");
  player.appendChild(source);
  player.load();
}

function attachFileSource(
  player: HTMLVideoElement,
  originalUrl: string,
  quality: string,
  extension?: string,
) {
  const url = new URL(originalUrl, window.location.origin);
  url.searchParams.set("quality", quality);
  attachOriginalSource(
    player,
    quality === "remux" ? `${url.pathname}${url.search}` : originalUrl,
    quality === "remux" ? "mp4" : extension,
  );
}

function restorePlayback(
  player: HTMLVideoElement,
  resumeTime: number,
  wasPlaying: boolean,
) {
  if (resumeTime > 0) player.currentTime = resumeTime;
  if (wasPlaying) void player.play().catch(() => {});
}

function reportAttachmentError(
  error: unknown,
  setPlaybackError: VideoSourceParams["setPlaybackError"],
) {
  setPlaybackError(
    error instanceof Error ? error.message : "HLS playback failed.",
  );
}

async function attachAdaptiveSource(
  params: AdaptiveSourceParams,
  player: HTMLVideoElement,
  resumeTime: number,
  wasPlaying: boolean,
  quality: () => string,
  isCancelled: () => boolean,
) {
  const hlsModule = await loadHlsModule();
  const HlsConstructor = hlsModule.default;
  if (isCancelled()) return;
  if (!HlsConstructor.isSupported()) {
    if (player.canPlayType("application/vnd.apple.mpegurl")) {
      player.src = params.hlsUrl;
      player.load();
    } else {
      params.setPlaybackError("This browser cannot play transcoded video.");
    }
    return;
  }
  player.removeAttribute("src");
  player.querySelectorAll("source").forEach((source) => source.remove());
  const hls = new HlsConstructor(createAdaptiveHlsConfig());
  params.hlsRef.current = hls;
  hls.on(HlsConstructor.Events.AUDIO_TRACKS_UPDATED, () =>
    params.updateHlsAudioTracks(hls),
  );
  hls.on(HlsConstructor.Events.AUDIO_TRACK_SWITCHED, (_event, data) =>
    params.updateSelectedAudioTrack(data.id),
  );
  hls.on(HlsConstructor.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      const missingSegment =
        data.response?.code === 404 &&
        data.details.toLowerCase().includes("frag");
      params.setPlaybackError(
        missingSegment
          ? "Video segment is missing."
          : data.response?.code === 425
            ? "Video segment is still being prepared."
            : data.type === HlsConstructor.ErrorTypes.MEDIA_ERROR
              ? "This browser cannot decode this stream."
              : `${data.type}: ${data.details}`,
      );
    }
  });
  hls.on(HlsConstructor.Events.MANIFEST_PARSED, () => {
    params.updateHlsAudioTracks(hls);
    hls.loadLevel = resolveManualLevel(
      quality(),
      hls.levels.map((level) => level.height),
    );
    restorePlayback(player, resumeTime, wasPlaying);
  });
  hls.on(HlsConstructor.Events.LEVEL_SWITCHED, (_event, data) => {
    params.setVideoHeight(hls.levels[data.level]?.height ?? null);
  });
  hls.loadSource(params.hlsUrl);
  hls.attachMedia(player);
}

function attachVideoSource(
  params: VideoSourceParams & AudioBindings,
  qualityRef: RefObject<string>,
  sourceRef: RefObject<string>,
) {
  params.resetAudioTracks();
  const player = params.videoRef.current;
  if (!player || params.selectedKind !== "video" || !params.originalUrl) {
    destroyHls(params.hlsRef);
    if (player) resetVideoSource(player);
    return;
  }
  const sameFile = sourceRef.current === params.originalUrl;
  const resumeTime = sameFile ? player.currentTime : 0;
  const wasPlaying = sameFile && !player.paused;
  sourceRef.current = params.originalUrl;
  params.setPlaybackError("");
  params.setPlaybackStatus("loading");
  params.setVideoHeight(null);
  destroyHls(params.hlsRef);
  const removeNativeAudioListeners = params.bindNativeAudioTracks(player);
  const onResize = () => params.setVideoHeight(player.videoHeight || null);
  const onLoadedMetadata = () =>
    restorePlayback(player, resumeTime, wasPlaying);
  player.addEventListener("resize", onResize);
  player.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
  let cancelled = false;
  if (["source", "remux"].includes(params.selectedQuality))
    attachFileSource(
      player,
      params.originalUrl,
      params.selectedQuality,
      params.extension,
    );
  else {
    resetVideoSource(player);
    void attachAdaptiveSource(
      params,
      player,
      resumeTime,
      wasPlaying,
      () => qualityRef.current,
      () => cancelled,
    ).catch((error: unknown) => {
      if (!cancelled) reportAttachmentError(error, params.setPlaybackError);
    });
  }
  return () => {
    cancelled = true;
    player.removeEventListener("resize", onResize);
    player.removeEventListener("loadedmetadata", onLoadedMetadata);
    removeNativeAudioListeners();
    destroyHls(params.hlsRef);
  };
}

function useAttachedVideoSource(
  params: VideoSourceParams,
  qualityRef: RefObject<string>,
  audio: AudioBindings,
) {
  const {
    extension,
    hlsRef,
    hlsUrl,
    originalUrl,
    selectedKind,
    setPlaybackError,
    setPlaybackStatus,
    setVideoHeight,
    videoRef,
  } = params;
  const sourceRef = useRef("");
  const {
    resetAudioTracks,
    updateHlsAudioTracks,
    updateSelectedAudioTrack,
    bindNativeAudioTracks,
  } = audio;
  const fileQuality = ["source", "remux"].includes(params.selectedQuality)
    ? params.selectedQuality
    : "";
  useEffect(
    () =>
      attachVideoSource(
        {
          extension,
          hlsRef,
          hlsUrl,
          originalUrl,
          selectedKind,
          selectedQuality: fileQuality,
          setPlaybackError,
          setPlaybackStatus,
          setVideoHeight,
          videoRef,
          resetAudioTracks,
          updateHlsAudioTracks,
          updateSelectedAudioTrack,
          bindNativeAudioTracks,
        },
        qualityRef,
        sourceRef,
      ),
    [
      extension,
      hlsRef,
      hlsUrl,
      originalUrl,
      selectedKind,
      fileQuality,
      setPlaybackError,
      setPlaybackStatus,
      setVideoHeight,
      videoRef,
      qualityRef,
      resetAudioTracks,
      updateHlsAudioTracks,
      updateSelectedAudioTrack,
      bindNativeAudioTracks,
    ],
  );
}

export function useVideoSource(params: VideoSourceParams) {
  const audio = useVideoAudioTracks(params.hlsRef, params.videoRef);
  const qualityRef = useRef(params.selectedQuality);
  const { hlsRef, selectedQuality } = params;
  useEffect(() => {
    qualityRef.current = selectedQuality;
    const hls = hlsRef.current;
    if (
      hls &&
      !["source", "remux"].includes(selectedQuality) &&
      hls.levels.length
    ) {
      hls.loadLevel = resolveManualLevel(
        selectedQuality,
        hls.levels.map((level) => level.height),
      );
    }
  }, [hlsRef, selectedQuality]);
  useAttachedVideoSource(params, qualityRef, audio);
  const {
    videoAudioTracks,
    selectedVideoAudioTrack,
    videoAudioMode,
    setSelectedVideoAudioTrack,
  } = audio;
  return {
    videoAudioTracks,
    selectedVideoAudioTrack,
    videoAudioMode,
    setSelectedVideoAudioTrack,
  };
}
