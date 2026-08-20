import React from "react";
import { CustomDropdown } from "../Common/CustomDropdown";
import { formatMediaTime } from "../../lib/formatterUtils";
import type { VideoPreviewProps } from "../../features/workspace/types";

type VideoRenderProps = Omit<VideoPreviewProps, "videoRef" | "videoShellRef">;

function VideoPreviewToolbar(props: VideoRenderProps) {
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
        preview
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

function VideoSeekControl(props: VideoRenderProps) {
  const maximum = Math.max(1, props.videoDuration);
  function updateHoverTime(event: React.MouseEvent<HTMLInputElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)),
    );
    props.setVideoSeekHoverTime((props.videoDuration || 0) * ratio);
  }
  return (
    <div
      className="video-progress-shell"
      onMouseLeave={() => props.setVideoSeekHoverTime(null)}
    >
      <div className="video-buffer-track">
        <span
          className="video-buffer-value"
          style={{ width: `${props.videoBufferedPercent}%` }}
        />
        <span
          className="video-played-value"
          style={{ width: `${props.videoPlayedPercent}%` }}
        />
      </div>
      <input
        aria-label="Seek video"
        className="video-progress-range"
        type="range"
        min={0}
        max={maximum}
        step={0.05}
        value={Math.min(props.videoCurrentTime, maximum)}
        onChange={(event) =>
          props.seekVideoTo(Number(event.currentTarget.value) || 0)
        }
        onMouseMove={updateHoverTime}
      />
      {props.videoSeekHoverTime != null && props.videoSeekPreviewUrl ? (
        <div className="video-seek-preview">
          <img src={props.videoSeekPreviewUrl} alt="Seek preview" />
          <span>{formatMediaTime(props.videoSeekHoverTime)}</span>
        </div>
      ) : null}
    </div>
  );
}

function VideoControls(props: VideoRenderProps) {
  return (
    <div className="custom-video-controls">
      <button
        className="ghost-button compact-button"
        type="button"
        onClick={props.toggleVideoPlayback}
      >
        {props.videoIsPlaying ? "Pause" : "Play"}
      </button>
      <span className="video-time-label">
        {formatMediaTime(props.videoCurrentTime)} /{" "}
        {formatMediaTime(props.videoDuration)}
      </span>
      <VideoSeekControl {...props} />
      <label className="video-volume-shell">
        Vol
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={props.videoVolume}
          onChange={(event) =>
            props.setVideoVolume(Number(event.currentTarget.value) || 0)
          }
        />
      </label>
      <label className="video-volume-shell">
        Speed
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={props.videoPlaybackRate}
          onChange={(event) =>
            props.setVideoPlaybackRate(
              Math.max(
                0.25,
                Math.min(3, Number(event.currentTarget.value) || 1),
              ),
            )
          }
        />
      </label>
      <button
        className="ghost-button compact-button"
        type="button"
        onClick={props.toggleVideoFullscreen}
      >
        {props.videoIsFullscreen ? "Exit Full" : "Full"}
      </button>
    </div>
  );
}

type PlaybackMetadataProps = VideoRenderProps &
  Pick<VideoPreviewProps, "videoRef">;

function adjustPlaybackRate(props: PlaybackMetadataProps, amount: number) {
  const video = props.videoRef.current;
  if (!video) return;
  const nextRate = Math.max(
    0.25,
    Math.min(3, video.playbackRate + amount * props.keyboardSettings.rateStep),
  );
  video.playbackRate = nextRate;
  props.setVideoPlaybackRate(nextRate);
}

function PlaybackMetadata(props: PlaybackMetadataProps) {
  const activeTranscode = props.activeJob?.phase === "transcoding";
  return (
    <div className="progress-meta-row">
      <span>
        Jump: {props.keyboardSettings.jumpSeconds}s | Rate step:{" "}
        {props.keyboardSettings.rateStep}x
      </span>
      <span>
        {activeTranscode
          ? `Transcoding ${props.activeJob?.videoQuality || props.selectedVideoQuality}: ${props.activeJob?.transcodedEntries || 0}/${props.activeJob?.totalTranscodeEntries || 0}`
          : `Playing ${props.selectedVideoQuality} quality`}
      </span>
      <div className="message-actions">
        <button
          className="ghost-button compact-button"
          type="button"
          onClick={() => adjustPlaybackRate(props, -1)}
        >
          Slower
        </button>
        <button
          className="ghost-button compact-button"
          type="button"
          onClick={() => adjustPlaybackRate(props, 1)}
        >
          Faster
        </button>
      </div>
    </div>
  );
}

function VideoNavigationHint({
  keyboardSettings,
}: Pick<VideoPreviewProps, "keyboardSettings">) {
  return (
    <div className="navigation-hint">
      Arrow left and right seek by {keyboardSettings.jumpSeconds}s, arrow up and
      down changes volume, [ ] changes speed, and f toggles fullscreen. You can
      click the seek bar to jump.
    </div>
  );
}

export function VideoPreviewContent({
  videoRef,
  videoShellRef,
  ...renderProps
}: VideoPreviewProps) {
  return (
    <div className="preview-stage">
      <VideoPreviewToolbar {...renderProps} />
      <div className="image-frame media-frame" ref={videoShellRef}>
        <video
          ref={videoRef}
          className="video-player"
          playsInline
          preload="metadata"
        >
          Your browser cannot play this video inline.
        </video>
        <VideoControls {...renderProps} />
      </div>
      <PlaybackMetadata {...renderProps} videoRef={videoRef} />
      <VideoNavigationHint keyboardSettings={renderProps.keyboardSettings} />
      {renderProps.videoPlaybackError ? (
        <div className="navigation-hint" role="alert">
          Video error: {renderProps.videoPlaybackError}
        </div>
      ) : null}
    </div>
  );
}
