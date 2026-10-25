import { useEffect, useRef, useState } from "react";
import type { VideoPreviewProps } from "../../features/workspace/types";
import { useVideoResume } from "../../features/player/useVideoResume";
import { VideoScrubber } from "./VideoScrubber";
import { VideoSettings, transcodeAction } from "./VideoSettings";
import { VideoPlayerControls } from "./VideoPlayerControls";

type VideoPreviewDetailsProps = Omit<VideoPreviewProps, "videoRef" | "videoShellRef">;

function selectedRendition(props: VideoPreviewDetailsProps) {
  return (
    props.videoHlsStatus?.renditions.find(
      ({ quality }) =>
        quality === props.selectedVideoQuality ||
        (props.selectedVideoQuality === "auto" && quality === `${props.videoHeight}p`),
    ) ?? (props.selectedVideoQuality === "auto" ? props.videoHlsStatus?.renditions[0] : undefined)
  );
}

function playbackLabel(props: VideoPreviewDetailsProps) {
  const quality =
    props.selectedVideoQuality === "source"
      ? "Original"
      : props.selectedVideoQuality === "remux"
        ? "Remux"
        : props.selectedVideoQuality === "auto"
          ? `Auto${props.videoHeight ? ` · ${props.videoHeight}p` : ""}`
          : props.selectedVideoQuality;
  if (props.videoPlaybackError) return "Playback needs attention";
  const rendition = selectedRendition(props);
  const preparing =
    !["source", "remux"].includes(props.selectedVideoQuality) &&
    props.videoPlaybackStatus !== "ready";
  if (preparing && rendition?.status === "queued") return "Waiting for video encoder";
  if (preparing && rendition?.status === "running" && !rendition.availableSegments)
    return "Preparing video";
  if (props.videoPlaybackStatus === "buffering") return "Buffering video";
  if (props.videoPlaybackStatus === "loading") return "Loading video";
  if (props.activeJob?.phase === "transcoding")
    return `Transcoding ${props.activeJob.videoQuality || props.selectedVideoQuality}: ${props.activeJob.transcodedEntries || 0}/${props.activeJob.totalTranscodeEntries || 0}`;
  return `${quality} playback`;
}

function playbackState(props: VideoPreviewDetailsProps) {
  const noPeers =
    props.activeJob?.sessionId === props.sessionId &&
    props.activeJob.sourceKind === "torrent" &&
    props.activeJob.status === "downloading" &&
    props.activeJob.peerCount === 0;
  const rendition = selectedRendition(props);
  const status = noPeers ? "Waiting for peers" : playbackLabel(props);
  return { status, noPeers, rendition };
}

function PlaybackStatus(props: VideoPreviewDetailsProps) {
  const { status, noPeers, rendition } = playbackState(props);
  return (
    <div className="progress-meta-row">
      <span aria-live="polite">{status}</span>
      {noPeers ? (
        <button className="ghost-button" type="button" onClick={props.onOpenDownloads}>
          Open downloads
        </button>
      ) : rendition?.status === "queued" && props.videoPlaybackStatus !== "ready" ? (
        <button
          className="ghost-button"
          type="button"
          onClick={() => props.setSelectedVideoQuality("source")}
        >
          Try Original
        </button>
      ) : null}
    </div>
  );
}

function PlaybackResume(resume: ReturnType<typeof useVideoResume>) {
  if (resume.position === null) return null;
  return (
    <div className="progress-meta-row" aria-label="Resume playback">
      <button className="ghost-button" type="button" onClick={resume.continuePlayback}>
        Continue from {Math.floor(resume.position / 60)}:
        {String(Math.floor(resume.position % 60)).padStart(2, "0")}
      </button>
      <button className="ghost-button" type="button" onClick={resume.startOver}>
        Start over
      </button>
    </div>
  );
}
function PlaybackRecovery(
  props: Pick<
    VideoPreviewDetailsProps,
    | "videoPlaybackError"
    | "videoQualityOptions"
    | "selectedVideoQuality"
    | "setSelectedVideoQuality"
    | "retryVideoPlayback"
  >,
) {
  return props.videoPlaybackError ? (
    <div className="navigation-hint" role="alert">
      <span>{props.videoPlaybackError}</span>{" "}
      {transcodeAction(props, "Try adaptive playback") ??
        (props.videoPlaybackError === "This browser cannot decode this stream." &&
        props.selectedVideoQuality !== "source" ? (
          <button
            className="ghost-button"
            type="button"
            onClick={() => props.setSelectedVideoQuality("source")}
          >
            Try Original
          </button>
        ) : (
          <button className="ghost-button" type="button" onClick={props.retryVideoPlayback}>
            Retry playback
          </button>
        ))}
    </div>
  ) : null;
}

export function VideoPreviewContent({ videoRef, videoShellRef, ...props }: VideoPreviewProps) {
  const resume = useVideoResume(videoRef, props.sessionId, props.selectedNode.path);
  const [native, setNative] = useState(false);
  const [controlError, setControlError] = useState("");
  const settingsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    setNative(false);
    setControlError("");
    if (settingsRef.current) settingsRef.current.open = false;
  }, [props.sessionId, props.selectedNode.path]);
  useEffect(() => {
    if (native && controlError) videoRef.current?.focus();
  }, [native, controlError, videoRef]);
  const fallback = () => {
    setNative(true);
    setControlError("Use the browser controls to continue playback or enter fullscreen.");
  };
  return (
    <div className="preview-stage">
      <div className="video-shell" ref={videoShellRef}>
        <div className="image-frame media-frame">
          <video
            ref={videoRef}
            aria-label="Video preview"
            className="video-player"
            controls={native}
            tabIndex={native ? 0 : undefined}
            playsInline
            preload="metadata"
          >
            Your browser cannot play this video inline.
          </video>
        </div>
        {!native ? (
          <>
            <VideoScrubber
              path={props.selectedNode.path}
              quality={props.selectedVideoQuality}
              sessionId={props.sessionId}
              videoRef={videoRef}
            />
            <VideoPlayerControls
              videoRef={videoRef}
              videoShellRef={videoShellRef}
              onFallback={fallback}
            />
          </>
        ) : null}
        <VideoSettings
          {...props}
          videoRef={videoRef}
          settingsRef={settingsRef}
          native={native}
          onNativeChange={(value) => {
            setNative(value);
            setControlError("");
          }}
        />
        <PlaybackResume {...resume} />
        <PlaybackStatus {...props} />
        {controlError ? <p role="status">{controlError}</p> : null}
        <PlaybackRecovery {...props} />
      </div>
    </div>
  );
}
