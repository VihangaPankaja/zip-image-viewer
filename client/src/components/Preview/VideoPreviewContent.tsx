import { CustomDropdown } from "../Common/CustomDropdown";
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
        {String(props.selectedNode.extension || "video").toUpperCase()} stream
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
  const activeTranscode = props.activeJob?.phase === "transcoding";
  return (
    <div className="progress-meta-row">
      <span>
        {activeTranscode
          ? `Transcoding ${props.activeJob?.videoQuality || props.selectedVideoQuality}: ${props.activeJob?.transcodedEntries || 0}/${props.activeJob?.totalTranscodeEntries || 0}`
          : `Adaptive stream · ${props.selectedVideoQuality} quality`}
      </span>
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
      {props.videoPlaybackError ? (
        <div className="navigation-hint" role="alert">
          Video error: {props.videoPlaybackError}
        </div>
      ) : null}
    </div>
  );
}
