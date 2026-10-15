import type { VideoPreviewProps } from "../../features/workspace/types";

type Props = Pick<
  VideoPreviewProps,
  | "audioTracks"
  | "videoAudioTracks"
  | "selectedVideoAudioTrack"
  | "videoAudioMode"
  | "setSelectedVideoAudioTrack"
  | "selectedVideoQuality"
  | "videoQualityOptions"
  | "setSelectedVideoQuality"
>;

export function VideoAudioTracks(props: Props) {
  const tracks = props.videoAudioTracks ?? [];
  const multipleTracks = (props.audioTracks?.length ?? 0) > 1;
  if (tracks.length <= 1 && !multipleTracks) return null;
  const filePlayback = ["source", "remux"].includes(props.selectedVideoQuality);
  return (
    <section className="video-subtitles" aria-label="Audio tracks">
      {tracks.length > 1 ? (
        <div className="video-subtitle-controls">
          <label>
            Audio language
            <select
              value={props.selectedVideoAudioTrack ?? ""}
              onChange={(event) =>
                props.setSelectedVideoAudioTrack?.(event.target.value)
              }
            >
              {!props.selectedVideoAudioTrack ? (
                <option value="" disabled>
                  Selecting audio…
                </option>
              ) : null}
              {tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
            </select>
          </label>
          <span className="video-subtitle-note">
            {props.videoAudioMode === "native"
              ? "Native audio selection"
              : "Audio changes preserve playback and captions."}
          </span>
        </div>
      ) : (
        <>
          <p className="video-subtitle-note">
            {filePlayback
              ? "This file has multiple audio languages. Adaptive playback makes them selectable."
              : "Use this browser's native audio controls when an audio picker is unavailable."}
          </p>
          {filePlayback &&
          props.videoQualityOptions.some(({ id }) => id === "auto") ? (
            <button
              className="ghost-button"
              type="button"
              onClick={() => props.setSelectedVideoQuality("auto")}
            >
              Switch to adaptive playback
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
