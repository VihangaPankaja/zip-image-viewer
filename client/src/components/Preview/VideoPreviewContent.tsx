import { CustomDropdown } from "../Common/CustomDropdown";
import { PlaybackDiagnostics } from "./PlaybackDiagnostics";
import type { VideoPreviewProps } from "../../features/workspace/types";

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

function PlaybackStatus(props: VideoPreviewDetailsProps) {
  const noPeers =
    props.activeJob?.sessionId === props.sessionId &&
    props.activeJob.sourceKind === "torrent" &&
    props.activeJob.status === "downloading" &&
    props.activeJob.peerCount === 0;
  const rendition =
    props.videoHlsStatus?.renditions.find(
      ({ quality }) =>
        quality === props.selectedVideoQuality ||
        (props.selectedVideoQuality === "auto" &&
          quality === `${props.videoHeight}p`),
    ) ??
    (props.selectedVideoQuality === "auto"
      ? props.videoHlsStatus?.renditions[0]
      : undefined);
  const quality =
    props.selectedVideoQuality === "source"
      ? "Original"
      : props.selectedVideoQuality === "auto"
        ? `Auto${props.videoHeight ? ` · ${props.videoHeight}p` : ""}`
        : props.selectedVideoQuality;
  let status = `${quality} playback`;
  if (props.activeJob?.phase === "transcoding")
    status = `Transcoding ${props.activeJob.videoQuality || props.selectedVideoQuality}: ${props.activeJob.transcodedEntries || 0}/${props.activeJob.totalTranscodeEntries || 0}`;
  if (props.videoPlaybackStatus === "loading") status = "Loading video";
  if (props.videoPlaybackStatus === "buffering") status = "Buffering video";
  if (
    props.selectedVideoQuality !== "source" &&
    props.videoPlaybackStatus !== "ready" &&
    rendition?.status === "running" &&
    !rendition.availableSegments
  )
    status = "Preparing video";
  if (
    props.selectedVideoQuality !== "source" &&
    props.videoPlaybackStatus !== "ready" &&
    rendition?.status === "queued"
  )
    status = "Waiting for video encoder";
  if (props.videoPlaybackError) status = "Playback needs attention";
  if (noPeers) status = "Waiting for peers";
  return (
    <div className="progress-meta-row">
      <span aria-live="polite">{status}</span>
      {noPeers ? (
        <button type="button" onClick={props.onOpenDownloads}>
          Open downloads
        </button>
      ) : rendition?.status === "queued" &&
        props.videoPlaybackStatus !== "ready" ? (
        <button
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

export function VideoPreviewContent({
  videoRef,
  videoShellRef,
  ...props
}: VideoPreviewProps) {
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
      <PlaybackStatus {...props} />
      <PlaybackDiagnostics
        hlsRef={props.hlsRef}
        videoRef={videoRef}
        selectedVideoQuality={props.selectedVideoQuality}
        videoHeight={props.videoHeight}
        videoPlaybackError={props.videoPlaybackError}
        videoHlsStatus={props.videoHlsStatus}
      />
      {props.videoPlaybackError ? (
        <div className="navigation-hint" role="alert">
          <span>{props.videoPlaybackError}</span>{" "}
          {props.videoPlaybackError === "This browser cannot play Original." &&
          props.videoQualityOptions.some(({ id }) => id === "auto") ? (
            <button
              type="button"
              onClick={() => props.setSelectedVideoQuality("auto")}
            >
              Try adaptive playback
            </button>
          ) : props.videoPlaybackError ===
              "This browser cannot decode this stream." &&
            props.selectedVideoQuality !== "source" ? (
            <button
              type="button"
              onClick={() => props.setSelectedVideoQuality("source")}
            >
              Try Original
            </button>
          ) : (
            <button type="button" onClick={props.retryVideoPlayback}>
              Retry playback
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
