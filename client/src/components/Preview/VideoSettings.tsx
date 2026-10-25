import { useEffect, useState, type RefObject } from "react";
import type { VideoPreviewProps } from "../../features/workspace/types";
import { CustomDropdown } from "../Common/CustomDropdown";
import { VideoSubtitles } from "./VideoSubtitles";
import { VideoAudioTracks } from "./VideoAudioTracks";
import { PlaybackDiagnostics } from "./PlaybackDiagnostics";
type VideoPreviewDetailsProps = Omit<VideoPreviewProps, "videoRef" | "videoShellRef">;
export function transcodeAction(
  props: Pick<
    VideoPreviewDetailsProps,
    "selectedVideoQuality" | "videoQualityOptions" | "setSelectedVideoQuality"
  >,
  label: string,
) {
  return ["source", "remux"].includes(props.selectedVideoQuality) &&
    props.videoQualityOptions.some(({ id }) => id === "auto") ? (
    <button
      className="ghost-button"
      type="button"
      onClick={() => props.setSelectedVideoQuality("auto")}
    >
      {label}
    </button>
  ) : null;
}
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
      <span>{(props.selectedNode.extension || "video").toUpperCase()} stream</span>
      <CustomDropdown
        id="video-quality"
        label="Quality"
        value={props.selectedVideoQuality}
        options={qualityOptions}
        onChange={(value) => props.setSelectedVideoQuality(String(value))}
      />
      <span>
        Mode:{" "}
        {props.selectedVideoQuality === "source"
          ? props.videoQualityOptions.find(({ id }) => id === "source")?.label === "Direct play"
            ? "Direct play"
            : "Original file"
          : props.selectedVideoQuality === "remux"
            ? "Remux"
            : "Transcode"}
      </span>
      {(props.audioTracks?.length ?? 0) > 1 && (props.videoAudioTracks?.length ?? 0) <= 1
        ? null
        : transcodeAction(props, "Transcode instead")}
      <span>{props.formatDate(props.selectedNode.modifiedAt ?? 0)}</span>
    </div>
  );
}

export function VideoSettings({
  videoRef,
  settingsRef,
  native,
  onNativeChange,
  ...props
}: Omit<VideoPreviewProps, "videoShellRef"> & {
  settingsRef: RefObject<HTMLDetailsElement | null>;
  native: boolean;
  onNativeChange: (value: boolean) => void;
}) {
  useEffect(() => {
    const details = settingsRef.current;
    if (!details) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      event.preventDefault();
      event.stopPropagation();
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    details.addEventListener("keydown", close);
    return () => details.removeEventListener("keydown", close);
  }, [settingsRef]);
  return (
    <details ref={settingsRef} className="video-settings">
      <summary>Video settings</summary>
      <VideoPreviewToolbar {...props} />
      <label className="video-native-choice">
        <input
          type="checkbox"
          checked={native}
          onChange={(event) => {
            onNativeChange(event.currentTarget.checked);
          }}
        />{" "}
        Use browser controls
      </label>
      <VideoPlaybackSpeed videoRef={videoRef} />
      <VideoSubtitles
        key={JSON.stringify([props.sessionId, props.selectedNode.path])}
        videoRef={videoRef}
        embeddedTracks={props.subtitleTracks}
        path={props.selectedNode.path}
        sessionId={props.sessionId}
      />
      <VideoAudioTracks {...props} />
      <PlaybackDiagnostics
        hlsRef={props.hlsRef}
        videoRef={videoRef}
        selectedVideoQuality={props.selectedVideoQuality}
        videoHeight={props.videoHeight}
        videoPlaybackError={props.videoPlaybackError}
        videoHlsStatus={props.videoHlsStatus}
      />
      <p className="navigation-hint">
        Fullscreen: J/L seek ±{props.keyboardSettings.jumpSeconds}s. Up/Down change volume. Brackets
        change speed by {props.keyboardSettings.rateStep}x.
      </p>
    </details>
  );
}
function VideoPlaybackSpeed({ videoRef }: Pick<VideoPreviewProps, "videoRef">) {
  const [rate, setRate] = useState(1);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setRate(video.playbackRate);
    sync();
    video.addEventListener("ratechange", sync);
    return () => video.removeEventListener("ratechange", sync);
  }, [videoRef]);
  return (
    <label className="video-speed">
      Playback speed
      <input
        type="number"
        min="0.25"
        max="3"
        step="0.05"
        value={rate}
        onChange={(event) => {
          const value = event.currentTarget.valueAsNumber;
          if (videoRef.current && Number.isFinite(value))
            videoRef.current.playbackRate = Math.max(0.25, Math.min(3, value));
        }}
      />
    </label>
  );
}
