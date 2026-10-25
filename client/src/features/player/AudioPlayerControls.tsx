import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import { useAudioPlayer } from "./audioContext";
import { audioTime } from "./audioQueue";
import type { AudioPlayback } from "./useAudioPlayback";
import { CustomDropdown } from "../../components/Common/CustomDropdown";

function AudioArtwork({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img className="audio-artwork" src={src} alt="Album artwork" onError={() => setFailed(true)} />
  ) : (
    <span className="audio-artwork audio-artwork-empty" role="img" aria-label="No album artwork">
      <Music2 aria-hidden="true" size={36} />
    </span>
  );
}

function AudioTimeline({ player }: { player: AudioPlayback }) {
  const { media } = player;
  return (
    <div className="audio-timeline">
      <span>{audioTime(media.time)}</span>
      <input
        type="range"
        aria-label="Audio position"
        min="0"
        max={media.duration || 1}
        step="0.1"
        value={Math.min(media.time, media.duration)}
        disabled={!media.duration}
        aria-valuetext={`${audioTime(media.time)} of ${media.duration ? audioTime(media.duration) : "unknown duration"}`}
        onChange={(event) => player.seek(Number(event.currentTarget.value))}
      />
      <span>{media.duration ? audioTime(media.duration) : "Duration unknown"}</span>
    </div>
  );
}

function AudioTransport({ player }: { player: AudioPlayback }) {
  return (
    <div className="audio-transport" role="group" aria-label="Audio transport">
      <button
        className="ghost-button"
        type="button"
        aria-label="Previous track"
        disabled={!player.canPrevious}
        onClick={() => player.move(-1)}
      >
        <SkipBack aria-hidden="true" />
      </button>
      <button
        className="ghost-button"
        type="button"
        aria-label="Back 10 seconds"
        disabled={!player.media.duration}
        onClick={() => player.seek(player.media.time - 10)}
      >
        −10s
      </button>
      <button
        className="primary-button audio-play"
        type="button"
        aria-label={player.media.paused ? "Play audio" : "Pause audio"}
        onClick={() => (player.media.paused ? player.play() : player.audioRef.current?.pause())}
      >
        {player.media.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {player.media.paused ? "Play" : "Pause"}
      </button>
      <button
        className="ghost-button"
        type="button"
        aria-label="Forward 10 seconds"
        disabled={!player.media.duration}
        onClick={() => player.seek(player.media.time + 10)}
      >
        +10s
      </button>
      <button
        className="ghost-button"
        type="button"
        aria-label="Next track"
        disabled={!player.canNext}
        onClick={() => player.move(1)}
      >
        <SkipForward aria-hidden="true" />
      </button>
    </div>
  );
}

function AudioQueue({ player }: { player: AudioPlayback }) {
  const [limit, setLimit] = useState(50);
  return (
    <details className="audio-queue">
      <summary>
        Queue · {player.queue.length} {player.queue.length === 1 ? "track" : "tracks"}
      </summary>
      <ol>
        {player.queue.slice(0, limit).map((track, index) => (
          <li key={track.path}>
            <button
              className="audio-queue-name"
              type="button"
              aria-label={`Queue ${track.name}`}
              aria-current={track.path === player.track?.path ? "true" : undefined}
              title={track.path}
              onClick={() => player.choose(track)}
            >
              {track.name}
            </button>
            <button
              className="ghost-button"
              type="button"
              aria-label={`Move ${track.name} up`}
              disabled={index === 0}
              onClick={() => player.reorder(track.path, -1)}
            >
              <ArrowUp aria-hidden="true" />
            </button>
            <button
              className="ghost-button"
              type="button"
              aria-label={`Move ${track.name} down`}
              disabled={index === player.queue.length - 1}
              onClick={() => player.reorder(track.path, 1)}
            >
              <ArrowDown aria-hidden="true" />
            </button>
            <button
              className="ghost-button"
              type="button"
              aria-label={`Remove ${track.name} from queue`}
              onClick={() => player.remove(track.path)}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      {limit < player.queue.length ? (
        <button className="ghost-button" type="button" onClick={() => setLimit(limit + 50)}>
          Show more tracks
        </button>
      ) : null}
    </details>
  );
}

function AudioOptions({ player }: { player: AudioPlayback }) {
  const { media } = player;
  return (
    <div className="audio-options">
      {!player.native ? (
        <>
          <button
            className="ghost-button"
            type="button"
            aria-label={media.muted ? "Unmute audio" : "Mute audio"}
            aria-pressed={media.muted}
            onClick={player.mute}
          >
            {media.muted ? "Unmute" : "Mute"}
          </button>
          <label className="audio-volume">
            Volume
            <input
              type="range"
              aria-label="Audio volume"
              min="0"
              max="1"
              step="0.05"
              value={media.muted ? 0 : media.volume}
              onChange={(event) => player.volume(Number(event.currentTarget.value))}
            />
          </label>
          <CustomDropdown
            id="audio-speed"
            label="Speed"
            value={media.rate}
            options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({
              value,
              label: `${value}×`,
            }))}
            onChange={(value) => player.rate(Number(value))}
          />
        </>
      ) : null}
      {player.media.loading && !player.error ? <p role="status">Loading audio…</p> : null}
      <CustomDropdown
        id="audio-repeat"
        label="Repeat"
        value={player.repeat}
        options={[
          { value: "off", label: "Off" },
          { value: "all", label: "Queue" },
          { value: "one", label: "Track" },
        ]}
        onChange={(value) => player.setRepeat(String(value))}
      />
      <button
        className="ghost-button"
        type="button"
        aria-pressed={player.shuffle}
        onClick={player.toggleShuffle}
      >
        Shuffle
      </button>
    </div>
  );
}

export function AudioPlayerControls({ compact = false }: { compact?: boolean }) {
  const player = useAudioPlayer();
  if (!player) return null;
  if (!player.track)
    return (
      <div className="audio-controls">
        <p>Queue empty</p>
        <button className="ghost-button" type="button" onClick={player.restoreQueue}>
          Load session audio
        </button>
      </div>
    );
  const { track } = player;
  return (
    <div className={`audio-controls ${compact ? "audio-controls-compact" : ""}`}>
      {!compact ? (
        <div className="audio-now-playing">
          <AudioArtwork key={track.artwork} src={track.artwork} />
          <div>
            <p className="panel-label">Now playing</p>
            <h3 title={track.name}>{track.name}</h3>
            <p>{track.album}</p>
          </div>
        </div>
      ) : null}
      {!player.native ? (
        <>
          <AudioTimeline player={player} />
          <AudioTransport player={player} />
        </>
      ) : null}
      {player.error ? (
        <div className="audio-error" role="alert">
          <p>{player.error}</p>
          <button className="ghost-button" type="button" onClick={player.retry}>
            Retry audio
          </button>
          <a className="ghost-button inline-link" href={track.url} download>
            Download original audio
          </a>
        </div>
      ) : null}
      {!compact ? (
        <>
          <AudioOptions player={player} />
          <AudioQueue player={player} />
        </>
      ) : null}
      <label className="audio-native-choice">
        <input
          type="checkbox"
          checked={player.native}
          onChange={(event) => player.setNative(event.currentTarget.checked)}
        />
        Use browser audio controls
      </label>
    </div>
  );
}
