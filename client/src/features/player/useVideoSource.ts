import type Hls from "hls.js";
import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { getVideoMimeType } from "../../lib/mimeTypeSystem";
import {
  AUTO_QUALITY,
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
  selectedNode: object | null;
  selectedQuality: string;
  setPlaybackError: Dispatch<SetStateAction<string>>;
  videoRef: RefObject<HTMLVideoElement | null>;
};

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

async function attachAdaptiveSource(
  params: VideoSourceParams,
  player: HTMLVideoElement,
  resumeTime: number,
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
  const hls = new HlsConstructor(createAdaptiveHlsConfig());
  params.hlsRef.current = hls;
  hls.on(HlsConstructor.Events.ERROR, (_event, data) => {
    if (data.fatal) {
      params.setPlaybackError(data.details);
    }
  });
  hls.on(HlsConstructor.Events.MANIFEST_PARSED, () => {
    hls.currentLevel = resolveManualLevel(
      params.selectedQuality === "source"
        ? AUTO_QUALITY
        : params.selectedQuality,
      hls.levels.map((level) => level.height),
    );
    if (resumeTime > 0) player.currentTime = resumeTime;
  });
  hls.loadSource(params.hlsUrl);
  hls.attachMedia(player);
}

export function useVideoSource(params: VideoSourceParams) {
  const {
    extension,
    hlsRef,
    hlsUrl,
    originalUrl,
    selectedKind,
    selectedNode,
    selectedQuality,
    setPlaybackError,
    videoRef,
  } = params;
  useEffect(() => {
    const player = videoRef.current;
    if (!player || selectedKind !== "video" || !selectedNode) {
      destroyHls(hlsRef);
      return;
    }
    const resumeTime = player.currentTime;
    setPlaybackError("");
    destroyHls(hlsRef);
    let cancelled = false;
    if (selectedQuality === "source") {
      attachOriginalSource(player, originalUrl, extension);
    } else {
      void attachAdaptiveSource(
        {
          extension,
          hlsRef,
          hlsUrl,
          originalUrl,
          selectedKind,
          selectedNode,
          selectedQuality,
          setPlaybackError,
          videoRef,
        },
        player,
        resumeTime,
        () => cancelled,
      ).catch((error: unknown) => {
        if (!cancelled) {
          setPlaybackError(
            error instanceof Error ? error.message : "HLS playback failed.",
          );
        }
      });
    }
    return () => {
      cancelled = true;
      destroyHls(hlsRef);
    };
  }, [
    extension,
    hlsRef,
    hlsUrl,
    originalUrl,
    selectedKind,
    selectedNode,
    selectedQuality,
    setPlaybackError,
    videoRef,
  ]);
}
