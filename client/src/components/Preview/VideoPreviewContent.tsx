import React from "react";
import { CustomDropdown } from "../Common/CustomDropdown";
import { formatMediaTime } from "../../lib/formatterUtils";

export function VideoPreviewContent({
  selectedNode,
  formatBytes,
  formatDate,
  selectedVideoQuality,
  videoQualityOptions,
  setSelectedVideoQuality,
  videoShellRef,
  videoRef,
  videoIsPlaying,
  toggleVideoPlayback,
  videoCurrentTime,
  videoDuration,
  videoBufferedPercent,
  videoPlayedPercent,
  seekVideoTo,
  setVideoSeekHoverTime,
  videoSeekHoverTime,
  videoSeekPreviewUrl,
  videoVolume,
  setVideoVolume,
  videoPlaybackRate,
  setVideoPlaybackRate,
  videoIsFullscreen,
  toggleVideoFullscreen,
  keyboardSettings,
  activeJob,
  videoPlaybackError,
}) {
  return (
    <div className="preview-stage">
      <div className="preview-toolbar">
        <span>{formatBytes(selectedNode.size)}</span>
        <span>{selectedNode.extension.toUpperCase()} stream preview</span>
        <CustomDropdown
          id="video-quality"
          label="Quality"
          value={selectedVideoQuality}
          options={
            videoQualityOptions.length
              ? videoQualityOptions.map((item) => ({
                  value: item.id,
                  label: item.label,
                }))
              : [{ value: "source", label: "Original" }]
          }
          onChange={(value) => setSelectedVideoQuality(String(value))}
        />
        <span>{formatDate(selectedNode.modifiedAt)}</span>
      </div>
      <div className="image-frame media-frame" ref={videoShellRef}>
        <video
          ref={videoRef}
          className="video-player"
          playsInline
          preload="metadata"
        >
          Your browser cannot play this video inline.
        </video>
        <div className="custom-video-controls">
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={toggleVideoPlayback}
          >
            {videoIsPlaying ? "Pause" : "Play"}
          </button>
          <span className="video-time-label">
            {formatMediaTime(videoCurrentTime)} /{" "}
            {formatMediaTime(videoDuration)}
          </span>
          <div
            className="video-progress-shell"
            onMouseLeave={() => setVideoSeekHoverTime(null)}
          >
            <div className="video-buffer-track">
              <span
                className="video-buffer-value"
                style={{ width: `${videoBufferedPercent}%` }}
              />
              <span
                className="video-played-value"
                style={{ width: `${videoPlayedPercent}%` }}
              />
            </div>
            <input
              className="video-progress-range"
              type="range"
              min={0}
              max={Math.max(1, videoDuration)}
              step={0.05}
              value={Math.min(videoCurrentTime, Math.max(1, videoDuration))}
              onChange={(event) =>
                seekVideoTo(Number(event.currentTarget.value) || 0)
              }
              onMouseMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = Math.max(
                  0,
                  Math.min(
                    1,
                    (event.clientX - rect.left) / Math.max(1, rect.width),
                  ),
                );
                setVideoSeekHoverTime((videoDuration || 0) * ratio);
              }}
            />
            {videoSeekHoverTime != null && videoSeekPreviewUrl ? (
              <div className="video-seek-preview">
                <img src={videoSeekPreviewUrl} alt="Seek preview" />
                <span>{formatMediaTime(videoSeekHoverTime)}</span>
              </div>
            ) : null}
          </div>
          <label className="video-volume-shell">
            Vol
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={videoVolume}
              onChange={(event) =>
                setVideoVolume(Number(event.currentTarget.value) || 0)
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
              value={videoPlaybackRate}
              onChange={(event) =>
                setVideoPlaybackRate(
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
            onClick={toggleVideoFullscreen}
          >
            {videoIsFullscreen ? "Exit Full" : "Full"}
          </button>
        </div>
      </div>
      <div className="progress-meta-row">
        <span>
          Jump: {keyboardSettings.jumpSeconds}s | Rate step:{" "}
          {keyboardSettings.rateStep}x
        </span>
        <span>
          {activeJob?.phase === "transcoding"
            ? `Transcoding ${activeJob.videoQuality || selectedVideoQuality}: ${activeJob.transcodedEntries || 0}/${activeJob.totalTranscodeEntries || 0}`
            : `Playing ${selectedVideoQuality} quality`}
        </span>
        <div className="message-actions">
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={() => {
              if (!videoRef.current) return;
              const nextRate = Math.max(
                0.25,
                videoRef.current.playbackRate - keyboardSettings.rateStep,
              );
              videoRef.current.playbackRate = nextRate;
              setVideoPlaybackRate(nextRate);
            }}
          >
            Slower
          </button>
          <button
            className="ghost-button compact-button"
            type="button"
            onClick={() => {
              if (!videoRef.current) return;
              const nextRate = Math.min(
                3,
                videoRef.current.playbackRate + keyboardSettings.rateStep,
              );
              videoRef.current.playbackRate = nextRate;
              setVideoPlaybackRate(nextRate);
            }}
          >
            Faster
          </button>
        </div>
      </div>
      <div className="navigation-hint">
        Arrow left and right seek by {keyboardSettings.jumpSeconds}s, arrow up
        and down changes volume, [ ] changes speed, and f toggles fullscreen.
        You can click the seek bar to jump.
      </div>
      {videoPlaybackError ? (
        <div className="navigation-hint" role="alert">
          Video error: {videoPlaybackError}
        </div>
      ) : null}
    </div>
  );
}
