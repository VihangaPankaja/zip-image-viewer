import { useRef, type RefObject } from "react";
import { useVideoSubtitles } from "../../features/player/useVideoSubtitles";
import type { VideoMediaTrack } from "../../../../shared/contracts";

function CaptionSettings(subtitles: ReturnType<typeof useVideoSubtitles>) {
  return (
    <>
      <button
        className="ghost-button"
        type="button"
        aria-label="Captions"
        aria-pressed={subtitles.enabled}
        disabled={!subtitles.ready}
        onClick={() => subtitles.setEnabled(!subtitles.enabled)}
      >
        Captions {subtitles.enabled ? "on" : "off"}
      </button>
      <label>
        Caption size
        <select value={subtitles.size} onChange={(event) => subtitles.setSize(event.target.value)}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
      <label>
        Caption offset (seconds)
        <input
          type="number"
          min="-60"
          max="60"
          step="0.5"
          value={subtitles.offset}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isFinite(value)) subtitles.setOffset(Math.max(-60, Math.min(60, value)));
          }}
        />
      </label>
      <button className="ghost-button" type="button" onClick={subtitles.remove}>
        Remove subtitles
      </button>
    </>
  );
}

function SubtitleNotice(subtitles: ReturnType<typeof useVideoSubtitles>) {
  return (
    <>
      {subtitles.loading ? (
        <p className="video-subtitle-note" role="status">
          Loading subtitles…
        </p>
      ) : subtitles.file ? (
        <p className="video-subtitle-note" role="status">
          {subtitles.ready ? subtitles.file.name : "Loading subtitles…"} · Positive offset delays
          captions.
        </p>
      ) : (
        <p className="video-subtitle-note">
          Local WebVTT or SRT · Up to 2 MB · Files stay in your browser.
        </p>
      )}
      {subtitles.error && (
        <p className="video-subtitle-error" role="alert">
          {subtitles.error}
        </p>
      )}
    </>
  );
}

export function VideoSubtitles({
  videoRef,
  embeddedTracks,
  sessionId,
  path,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  embeddedTracks?: VideoMediaTrack[];
  sessionId?: string;
  path?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const subtitles = useVideoSubtitles(videoRef);
  return (
    <section className="video-subtitles" aria-label="Subtitles">
      <div className="video-subtitle-controls">
        {embeddedTracks?.length && sessionId && path ? (
          <label>
            Embedded subtitles
            <select
              value={subtitles.embeddedTrackId}
              onChange={(event) => {
                const track = embeddedTracks.find(({ id }) => id === event.target.value);
                if (track) void subtitles.loadEmbedded(track, sessionId, path);
                else subtitles.remove();
              }}
            >
              <option value="">Off</option>
              {embeddedTracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".vtt,.srt,text/vtt,application/x-subrip"
          aria-label="Subtitle file"
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (selected) void subtitles.load(selected);
          }}
        />
        <button className="ghost-button" type="button" onClick={() => inputRef.current?.click()}>
          Load subtitles
        </button>
        {subtitles.file && <CaptionSettings {...subtitles} />}
      </div>
      <SubtitleNotice {...subtitles} />
    </section>
  );
}
