import { useEffect, useState, type ReactNode } from "react";
import { useAudioPlayback, type AudioPlayback, type AudioWorkspace } from "./useAudioPlayback";
import { AudioPlayerControls } from "./AudioPlayerControls";
import { useAudioMediaSession } from "./useAudioMediaSession";
import { AudioContext } from "./audioContext";

export function AudioPlayerProvider({
  children,
  visible,
  filesVisible = false,
  onReveal,
  ...workspace
}: AudioWorkspace & {
  children: ReactNode;
  visible: boolean;
  filesVisible?: boolean;
  onReveal: () => void;
}) {
  const player = useAudioPlayback(workspace);
  const [ownsMediaSession, setOwnsMediaSession] = useState(false);
  const [mobile, setMobile] = useState(false);
  useAudioMediaSession(player, ownsMediaSession);
  useEffect(() => {
    const query = window.matchMedia("(width <= 760px), (width <= 960px) and (height <= 500px)");
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const pauseForVideo = (event: Event) => {
      if (event.target instanceof HTMLVideoElement) {
        player.audioRef.current?.pause();
        setOwnsMediaSession(false);
      }
    };
    document.addEventListener("play", pauseForVideo, true);
    return () => document.removeEventListener("play", pauseForVideo, true);
  }, [player.audioRef]);
  const compact = !visible || (mobile && filesVisible);
  const docked = Boolean(player.track && (compact || player.native));
  return (
    <AudioContext value={player}>
      <div className={docked ? "audio-workspace-layout" : undefined}>
        {children}
        <div className="audio-dock">
          <AudioElement player={player} onClaim={() => setOwnsMediaSession(true)} />
          {player.track && compact ? (
            <aside className="audio-persistent" aria-label="Persistent audio player">
              <button
                className="audio-reveal"
                type="button"
                onClick={() => {
                  if (player.track) workspace.onSelect(player.track.path);
                  onReveal();
                }}
                title={player.track.name}
              >
                {player.track.name}
              </button>
              <AudioPlayerControls compact />
            </aside>
          ) : null}
        </div>
      </div>
    </AudioContext>
  );
}

function AudioElement({ player, onClaim }: { player: AudioPlayback; onClaim: () => void }) {
  const { audioRef, native, track } = player;
  return (
    <audio
      ref={audioRef}
      aria-label="Audio playback"
      className={native ? "audio-native-player" : "audio-hidden-media"}
      controls={native}
      hidden={!track}
      preload="metadata"
      onPlay={() => {
        document.querySelectorAll("video").forEach((video) => video.pause());
        onClaim();
        player.sync();
      }}
      onPause={player.sync}
      onTimeUpdate={player.sync}
      onLoadedMetadata={player.sync}
      onDurationChange={player.sync}
      onVolumeChange={player.sync}
      onRateChange={player.sync}
      onWaiting={player.sync}
      onCanPlay={player.sync}
      onEnded={player.ended}
      onError={() =>
        player.setError(
          "This audio could not be loaded or decoded. Retry, use browser controls, or download the original.",
        )
      }
    />
  );
}
