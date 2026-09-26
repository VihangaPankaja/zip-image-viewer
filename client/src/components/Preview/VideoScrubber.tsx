import { useEffect, useRef, useState, type RefObject } from "react";

type VideoScrubberProps = {
  path: string;
  quality: string;
  sessionId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
};

const THUMBNAIL_INTERVAL_SECONDS = 5;

function finiteDuration(video: HTMLVideoElement) {
  return Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : 0;
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function thumbnailUrl(
  sessionId: string,
  path: string,
  quality: string,
  time: number,
  duration: number,
) {
  const quantized =
    Math.min(
      Math.round(time / THUMBNAIL_INTERVAL_SECONDS),
      Math.max(0, Math.ceil(duration / THUMBNAIL_INTERVAL_SECONDS) - 1),
    ) * THUMBNAIL_INTERVAL_SECONDS;
  const query = new URLSearchParams({
    path,
    time: String(quantized),
    quality,
    width: "320",
  });
  return `/api/sessions/${encodeURIComponent(sessionId)}/video/thumbnail?${query.toString()}`;
}

function useVideoScrubPosition({
  path,
  sessionId,
  videoRef,
}: VideoScrubberProps) {
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [previewPosition, setPreviewPosition] = useState<number | null>(null);
  const previewRef = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    setDuration(0);
    setPosition(0);
    setPreviewPosition(null);
    previewRef.current = null;
    if (!video) return;
    const syncDuration = () => setDuration(finiteDuration(video));
    const syncPosition = () => {
      if (Number.isFinite(video.currentTime)) setPosition(video.currentTime);
    };
    syncDuration();
    syncPosition();
    video.addEventListener("loadedmetadata", syncDuration);
    video.addEventListener("durationchange", syncDuration);
    video.addEventListener("timeupdate", syncPosition);
    return () => {
      video.removeEventListener("loadedmetadata", syncDuration);
      video.removeEventListener("durationchange", syncDuration);
      video.removeEventListener("timeupdate", syncPosition);
    };
  }, [path, sessionId, videoRef]);

  const preview = (time: number | null) => {
    previewRef.current = time;
    setPreviewPosition(time);
  };
  const commit = () => {
    if (previewRef.current === null) return;
    const video = videoRef.current;
    if (video) video.currentTime = previewRef.current;
    setPosition(previewRef.current);
    preview(null);
  };
  const cancel = () => {
    setPosition(videoRef.current?.currentTime ?? position);
    preview(null);
  };
  return { duration, position, previewPosition, preview, commit, cancel };
}

export function VideoScrubber(props: VideoScrubberProps) {
  const { duration, position, previewPosition, preview, commit, cancel } =
    useVideoScrubPosition(props);
  if (!duration) return null;
  const displayedPosition = previewPosition ?? position;
  return (
    <div className="video-scrubber">
      {previewPosition !== null && (
        <div className="video-scrubber-preview">
          <img
            src={thumbnailUrl(
              props.sessionId,
              props.path,
              props.quality,
              previewPosition,
              duration,
            )}
            alt={`Preview at ${formatTime(previewPosition)}`}
          />
          <span>{formatTime(previewPosition)}</span>
        </div>
      )}
      <div className="video-scrubber-control">
        <span>{formatTime(displayedPosition)}</span>
        <input
          type="range"
          aria-label="Seek video"
          aria-valuetext={`${formatTime(displayedPosition)} of ${formatTime(duration)}`}
          min="0"
          max={duration}
          step="0.25"
          value={displayedPosition}
          onInput={(event) => preview(Number(event.currentTarget.value))}
          onPointerUp={commit}
          onPointerCancel={cancel}
          onBlur={cancel}
          onKeyUp={(event) => {
            if (
              event.key.startsWith("Arrow") ||
              event.key === "Home" ||
              event.key === "End" ||
              event.key.startsWith("Page")
            ) {
              commit();
            }
          }}
        />
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
