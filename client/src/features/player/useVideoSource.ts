import type Hls from "hls.js";
import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { getVideoMimeType } from "../../lib/mimeTypeSystem";
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

type AdaptiveSourceParams = Pick<
  VideoSourceParams,
  | "extension"
  | "hlsRef"
  | "hlsUrl"
  | "originalUrl"
  | "setPlaybackError"
  | "setVideoHeight"
>;

function destroyHls(hlsRef: RefObject<Hls | null>) {
  hlsRef.current?.destroy();
  hlsRef.current = null;
}

function attachOriginalSource(
  player: HTMLVideoElement,
  originalUrl: string,
  extension?: string,
) {
  player.innerHTML = "";
  const source = document.createElement("source");
  source.src = originalUrl;
  source.type = getVideoMimeType(extension ?? "");
  player.appendChild(source);
  player.load();
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
      attachOriginalSource(player, params.originalUrl, params.extension);
    }
    return;
  }
  player.removeAttribute("src");
  player.replaceChildren();
  const hls = new HlsConstructor(createAdaptiveHlsConfig());
  params.hlsRef.current = hls;
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

function useAttachedVideoSource(
  params: VideoSourceParams,
  qualityRef: RefObject<string>,
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
  const isOriginal = params.selectedQuality === "source";
  useEffect(() => {
    const player = videoRef.current;
    if (!player || selectedKind !== "video" || !originalUrl) {
      destroyHls(hlsRef);
      return;
    }
    const sameFile = sourceRef.current === originalUrl;
    const resumeTime = sameFile ? player.currentTime : 0;
    const wasPlaying = sameFile && !player.paused;
    sourceRef.current = originalUrl;
    setPlaybackError("");
    setPlaybackStatus("loading");
    setVideoHeight(null);
    destroyHls(hlsRef);
    const onResize = () => setVideoHeight(player.videoHeight || null);
    const onLoadedMetadata = () =>
      restorePlayback(player, resumeTime, wasPlaying);
    player.addEventListener("resize", onResize);
    player.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    let cancelled = false;
    if (isOriginal) {
      attachOriginalSource(player, originalUrl, extension);
    } else {
      void attachAdaptiveSource(
        {
          extension,
          hlsRef,
          hlsUrl,
          originalUrl,
          setPlaybackError,
          setVideoHeight,
        },
        player,
        resumeTime,
        wasPlaying,
        () => qualityRef.current,
        () => cancelled,
      ).catch((error: unknown) => {
        if (!cancelled) reportAttachmentError(error, setPlaybackError);
      });
    }
    return () => {
      cancelled = true;
      player.removeEventListener("resize", onResize);
      player.removeEventListener("loadedmetadata", onLoadedMetadata);
      destroyHls(hlsRef);
    };
  }, [
    extension,
    hlsRef,
    hlsUrl,
    originalUrl,
    selectedKind,
    isOriginal,
    setPlaybackError,
    setPlaybackStatus,
    setVideoHeight,
    videoRef,
    qualityRef,
  ]);
}

export function useVideoSource(params: VideoSourceParams) {
  const qualityRef = useRef(params.selectedQuality);
  const { hlsRef, selectedQuality } = params;
  useEffect(() => {
    qualityRef.current = selectedQuality;
    const hls = hlsRef.current;
    if (hls && selectedQuality !== "source" && hls.levels.length) {
      hls.loadLevel = resolveManualLevel(
        selectedQuality,
        hls.levels.map((level) => level.height),
      );
    }
  }, [hlsRef, selectedQuality]);
  useAttachedVideoSource(params, qualityRef);
}
