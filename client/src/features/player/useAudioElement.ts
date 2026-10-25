import { useCallback, useRef, useState } from "react";
import type { AudioTrack } from "./audioQueue";

function useAudioState() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const request = useRef(0);
  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  const [error, setError] = useState("");
  const [media, setMedia] = useState({
    paused: true,
    time: 0,
    duration: 0,
    volume: 1,
    muted: false,
    rate: 1,
    loading: true,
  });
  const sync = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setMedia({
      paused: audio.paused,
      time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0,
      volume: audio.volume,
      muted: audio.muted,
      rate: audio.playbackRate,
      loading: audio.readyState < 2,
    });
  }, []);
  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.getAttribute("src")) return;
    const source = audio.src;
    const id = ++request.current;
    setError("");
    void audio.play().catch((failure: unknown) => {
      if (
        id !== request.current ||
        audio.src !== source ||
        (failure instanceof DOMException && failure.name === "AbortError")
      )
        return;
      setError("Playback could not start. Try Play again or use browser controls.");
    });
  }, []);
  return { audioRef, invalidate, error, setError, media, sync, play };
}

export function useAudioElement() {
  const state = useAudioState();
  const { audioRef, invalidate, sync, play, setError } = state;
  const [track, setTrack] = useState<AudioTrack | null>(null);
  const [native, setNativeState] = useState(false);
  const setNative = (value: boolean) => {
    setNativeState(value);
    if (value && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {
        setNativeState(false);
        setError("Exit fullscreen before using browser audio controls.");
      });
    }
  };
  const load = useCallback(
    (next: AudioTrack | null, keepPlaying: boolean) => {
      const audio = audioRef.current;
      if (!audio) return;
      const { volume, muted, playbackRate } = audio;
      invalidate();
      audio.pause();
      setTrack(next);
      setError("");
      if (next) audio.src = next.url;
      else audio.removeAttribute("src");
      audio.load();
      audio.volume = volume;
      audio.muted = muted;
      audio.playbackRate = playbackRate;
      sync();
      if (next && keepPlaying) play();
    },
    [audioRef, invalidate, play, setError, sync],
  );
  const seek = (time: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, time));
    sync();
  };
  const volume = (value: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = value;
      audio.muted = false;
      sync();
    }
  };
  const mute = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.muted = !audio.muted;
      sync();
    }
  };
  const rate = (value: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = value;
      sync();
    }
  };
  return { ...state, track, native, setNative, load, seek, volume, mute, rate };
}
