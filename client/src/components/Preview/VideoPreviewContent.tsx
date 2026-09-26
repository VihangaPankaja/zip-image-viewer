import { CustomDropdown } from "../Common/CustomDropdown";
import { PlaybackDiagnostics } from "./PlaybackDiagnostics";
import type { VideoPreviewProps } from "../../features/workspace/types";
import { useVideoResume } from "../../features/player/useVideoResume";

type VideoPreviewDetailsProps = Omit<
  VideoPreviewProps,
  "videoRef" | "videoShellRef"
>;

function VideoPreviewToolbar(props: VideoPreviewDetailsProps) {
  const qualityOptions = props.videoQualityOptions.length
    ? props.videoQualityOptions.map((item) => ({
        value: item.id,
        label: item.label,
      }))
    : [{ value: "source", label: "Original" }];
  return (
    <div className="preview-toolbar">
      <span>{props.formatBytes(props.selectedNode.size ?? 0)}</span>
      <span>
        {(props.selectedNode.extension || "video").toUpperCase()} stream
      </span>
      <CustomDropdown
        id="video-quality"
        label="Quality"
        value={props.selectedVideoQuality}
        options={qualityOptions}
        onChange={(value) => props.setSelectedVideoQuality(String(value))}
      />
      <span>{props.formatDate(props.selectedNode.modifiedAt ?? 0)}</span>
    </div>
  );
}

function selectedRendition(props: VideoPreviewDetailsProps) {
  return (
    props.videoHlsStatus?.renditions.find(
      ({ quality }) =>
        quality === props.selectedVideoQuality ||
        (props.selectedVideoQuality === "auto" &&
          quality === `${props.videoHeight}p`),
    ) ??
    (props.selectedVideoQuality === "auto"
      ? props.videoHlsStatus?.renditions[0]
      : undefined)
  );
}

function playbackLabel(props: VideoPreviewDetailsProps) {
  const quality =
    props.selectedVideoQuality === "source"
      ? "Original"
      : props.selectedVideoQuality === "auto"
        ? `Auto${props.videoHeight ? ` · ${props.videoHeight}p` : ""}`
        : props.selectedVideoQuality;
  if (props.videoPlaybackError) return "Playback needs attention";
  const rendition = selectedRendition(props);
  const preparing =
    props.selectedVideoQuality !== "source" &&
    props.videoPlaybackStatus !== "ready";
  if (preparing && rendition?.status === "queued")
    return "Waiting for video encoder";
  if (
    preparing &&
    rendition?.status === "running" &&
    !rendition.availableSegments
  )
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
        <button
          className="ghost-button"
          type="button"
          onClick={props.onOpenDownloads}
        >
          Open downloads
        </button>
      ) : rendition?.status === "queued" &&
        props.videoPlaybackStatus !== "ready" ? (
        <button
          className="ghost-button"
          type="button"
          onClick={() => props.setSelectedVideoQuality("source")}
        >
          Try Original
        </button>
      ) : null}
      <span>
        Keyboard: ±{props.keyboardSettings.jumpSeconds}s · speed step{" "}
        {props.keyboardSettings.rateStep}x
      </span>
    </div>
  );
}

function PlaybackResume(resume: ReturnType<typeof useVideoResume>) {
  if (resume.position === null) return null;
  return (
    <div className="progress-meta-row" aria-label="Resume playback">
      <button
        className="ghost-button"
        type="button"
        onClick={resume.continuePlayback}
      >
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
      {props.videoPlaybackError === "This browser cannot play Original." &&
      props.videoQualityOptions.some(({ id }) => id === "auto") ? (
        <button
          className="ghost-button"
          type="button"
          onClick={() => props.setSelectedVideoQuality("auto")}
        >
          Try adaptive playback
        </button>
      ) : props.videoPlaybackError ===
          "This browser cannot decode this stream." &&
        props.selectedVideoQuality !== "source" ? (
        <button
          className="ghost-button"
          type="button"
          onClick={() => props.setSelectedVideoQuality("source")}
        >
          Try Original
        </button>
      ) : (
        <button
          className="ghost-button"
          type="button"
          onClick={props.retryVideoPlayback}
        >
          Retry playback
        </button>
      )}
    </div>
  ) : null;
}

export function VideoPreviewContent({
  videoRef,
  videoShellRef,
  ...props
}: VideoPreviewProps) {
  const resume = useVideoResume(
    videoRef,
    props.sessionId,
    props.selectedNode.path,
  );
  return (
    <div className="preview-stage">
      <VideoPreviewToolbar {...props} />
      <div className="image-frame media-frame" ref={videoShellRef}>
        <video
          ref={videoRef}
          aria-label="Video preview"
          className="video-player"
          controls
          playsInline
          preload="metadata"
        >
          Your browser cannot play this video inline.
        </video>
      </div>
      <PlaybackResume {...resume} />
      <PlaybackStatus {...props} />
      <PlaybackDiagnostics
        hlsRef={props.hlsRef}
        videoRef={videoRef}
        selectedVideoQuality={props.selectedVideoQuality}
        videoHeight={props.videoHeight}
        videoPlaybackError={props.videoPlaybackError}
        videoHlsStatus={props.videoHlsStatus}
      />
      <PlaybackRecovery {...props} />
    </div>
  );
}
