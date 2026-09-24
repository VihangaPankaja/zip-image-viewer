import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

type VideoEventSyncParams = {
  selectedKind: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  setPlaybackError: Dispatch<SetStateAction<string>>;
  setPlaybackStatus: Dispatch<
    SetStateAction<"loading" | "buffering" | "ready">
  >;
};

export function useVideoEventSync(params: VideoEventSyncParams) {
  const { selectedKind, videoRef, setPlaybackError, setPlaybackStatus } =
    params;
  useEffect(() => {
    const player = videoRef.current;
    if (!player || selectedKind !== "video") return;

    const onError = () => {
      const mediaError = player.error;
      const detail =
        mediaError?.message ||
        (mediaError?.code
          ? `Playback failed (code ${mediaError.code}).`
          : "Playback failed.");
      setPlaybackError(
        mediaError?.code === 4 ? "This browser cannot play Original." : detail,
      );
    };

    const onWaiting = () =>
      setPlaybackStatus(player.currentTime > 0 ? "buffering" : "loading");
    const onReady = () => setPlaybackStatus("ready");
    player.addEventListener("loadstart", onWaiting);
    player.addEventListener("waiting", onWaiting);
    player.addEventListener("stalled", onWaiting);
    player.addEventListener("playing", onReady);
    player.addEventListener("canplay", onReady);

    player.addEventListener("error", onError);
    return () => {
      player.removeEventListener("error", onError);
      player.removeEventListener("loadstart", onWaiting);
      player.removeEventListener("waiting", onWaiting);
      player.removeEventListener("stalled", onWaiting);
      player.removeEventListener("playing", onReady);
      player.removeEventListener("canplay", onReady);
    };
  }, [selectedKind, setPlaybackError, setPlaybackStatus, videoRef]);
}
