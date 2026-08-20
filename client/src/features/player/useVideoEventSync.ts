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
};

export function useVideoEventSync(params: VideoEventSyncParams) {
  const { selectedKind, videoRef, setPlaybackError } = params;
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
      setPlaybackError(detail);
    };

    player.addEventListener("error", onError);
    return () => {
      player.removeEventListener("error", onError);
    };
  }, [selectedKind, setPlaybackError, videoRef]);
}
