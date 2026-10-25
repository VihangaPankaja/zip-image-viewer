import { useEffect, useState, type RefObject } from "react";
import { toggleVideoFullscreen } from "../../features/player/videoFullscreen";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  videoShellRef: RefObject<HTMLDivElement | null>;
  onFallback: () => void;
};

function useMediaControls({ videoRef, videoShellRef }: Props) {
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setPaused(video.paused);
      setMuted(video.muted);
      setVolume(video.volume);
    };
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    const events = ["play", "pause", "ended", "volumechange", "loadedmetadata", "emptied"];
    sync();
    syncFullscreen();
    events.forEach((event) => video.addEventListener(event, sync));
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      events.forEach((event) => video.removeEventListener(event, sync));
      document.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, [videoRef, videoShellRef]);
  return { paused, muted, volume, fullscreen };
}

export function VideoPlayerControls(props: Props) {
  const { videoRef, videoShellRef, onFallback } = props;
  const { paused, muted, volume, fullscreen } = useMediaControls(props);
  return (
    <div className="video-basic-controls" role="group" aria-label="Video controls">
      <button
        className="ghost-button"
        type="button"
        aria-label={paused ? "Play video" : "Pause video"}
        onClick={() => {
          const video = videoRef.current;
          if (!video) return;
          const source = video.currentSrc;
          if (video.paused)
            void video.play().catch((error: unknown) => {
              if (
                videoRef.current === video &&
                video.currentSrc === source &&
                !(error instanceof DOMException && error.name === "AbortError")
              )
                onFallback();
            });
          else video.pause();
        }}
      >
        {paused ? "Play" : "Pause"}
      </button>
      <button
        className="ghost-button"
        type="button"
        aria-label={muted ? "Unmute video" : "Mute video"}
        aria-pressed={muted}
        onClick={() => {
          const video = videoRef.current;
          if (video) video.muted = !video.muted;
        }}
      >
        {muted ? "Unmute" : "Mute"}
      </button>
      <label className="video-volume">
        Volume
        <input
          type="range"
          aria-label="Volume"
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : volume}
          onChange={(event) => {
            const video = videoRef.current;
            if (!video) return;
            video.volume = Number(event.currentTarget.value);
            video.muted = false;
          }}
        />
      </label>
      <button
        className="ghost-button"
        type="button"
        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={() =>
          void toggleVideoFullscreen(videoShellRef.current, videoRef.current).catch(onFallback)
        }
      >
        {fullscreen ? "Exit fullscreen" : "Fullscreen"}
      </button>
    </div>
  );
}
