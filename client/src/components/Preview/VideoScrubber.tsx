import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

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
) {
  const quantized =
    Math.round(time / THUMBNAIL_INTERVAL_SECONDS) * THUMBNAIL_INTERVAL_SECONDS;
  const query = new URLSearchParams({
    path,
    time: String(quantized),
    quality,
    width: "320",
  });
  return `/api/sessions/${encodeURIComponent(sessionId)}/video/thumbnail?${query.toString()}`;
}

export function VideoScrubber({
  path,
  quality,
  sessionId,
  videoRef,
}: VideoScrubberProps) {
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [previewPosition, setPreviewPosition] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const isPreviewingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    setDuration(0);
    setPosition(0);
    setPreviewPosition(0);
    setIsPreviewing(false);
    isPreviewingRef.current = false;
    if (!video) return;

    const syncDuration = () => setDuration(finiteDuration(video));
    const syncPosition = () => {
      if (!isPreviewingRef.current && Number.isFinite(video.currentTime)) {
        setPosition(video.currentTime);
        setPreviewPosition(video.currentTime);
      }
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

  const previewUrl = useMemo(
    () => thumbnailUrl(sessionId, path, quality, previewPosition),
    [path, previewPosition, quality, sessionId],
  );

  if (!duration) return null;

  const commit = () => {
    const video = videoRef.current;
    if (video) video.currentTime = previewPosition;
    setPosition(previewPosition);
    setIsPreviewing(false);
    isPreviewingRef.current = false;
  };

  return (
    <div className="video-scrubber">
      <div className="video-scrubber-preview">
        <img src={previewUrl} alt={`Preview at ${formatTime(previewPosition)}`} />
        <span>{formatTime(previewPosition)}</span>
      </div>
      <div className="video-scrubber-control">
        <span>{formatTime(isPreviewing ? previewPosition : position)}</span>
        <input
          type="range"
          aria-label="Seek video"
          aria-valuetext={`${formatTime(previewPosition)} of ${formatTime(duration)}`}
          min="0"
          max={duration}
          step="0.25"
          value={isPreviewing ? previewPosition : position}
          onInput={(event) => {
            setIsPreviewing(true);
            isPreviewingRef.current = true;
            setPreviewPosition(Number(event.currentTarget.value));
          }}
          onPointerUp={commit}
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
      <span className="sr-only" aria-live="polite">
        {isPreviewing ? "" : `Video position ${formatTime(position)}`}
      </span>
    </div>
  );
}
