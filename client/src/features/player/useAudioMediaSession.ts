import { useEffect, useEffectEvent } from "react";
import type { AudioPlayback } from "./useAudioPlayback";

export function useAudioMediaSession(player: AudioPlayback, active: boolean) {
  const latest = useEffectEvent(() => player);
  const { track, media } = player;
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track || !active) return;
    const session = navigator.mediaSession;
    const metadata =
      typeof MediaMetadata === "undefined"
        ? null
        : new MediaMetadata({
            title: track.name,
            album: track.album,
            artwork: track.artwork ? [{ src: new URL(track.artwork, location.href).href }] : [],
          });
    session.metadata = metadata;
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => latest().play(),
      pause: () => latest().audioRef.current?.pause(),
      stop: () => {
        latest().audioRef.current?.pause();
        latest().seek(0);
      },
      previoustrack: () => latest().move(-1),
      nexttrack: () => latest().move(1),
      seekbackward: (details) =>
        latest().seek((latest().audioRef.current?.currentTime ?? 0) - (details.seekOffset ?? 10)),
      seekforward: (details) =>
        latest().seek((latest().audioRef.current?.currentTime ?? 0) + (details.seekOffset ?? 10)),
      seekto: (details) => {
        if (details.seekTime !== undefined) latest().seek(details.seekTime);
      },
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        /* Some browsers implement only a subset of Media Session actions. */
      }
    }
    return () => {
      if (session.metadata !== metadata) return;
      for (const action of Object.keys(handlers)) {
        try {
          session.setActionHandler(action as MediaSessionAction, null);
        } catch {
          /* Unsupported actions have no handler to clear. */
        }
      }
      if (session.metadata === metadata) {
        session.metadata = null;
        session.playbackState = "none";
      }
    };
  }, [track, active]);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !active || !track) return;
    navigator.mediaSession.playbackState = media.paused ? "paused" : "playing";
    if (media.duration && media.time <= media.duration) {
      try {
        navigator.mediaSession.setPositionState({
          duration: media.duration,
          position: media.time,
          playbackRate: media.rate,
        });
      } catch {
        /* Native controls remain usable without OS position support. */
      }
    }
  }, [active, track, media.paused, media.duration, media.time, media.rate]);
}
