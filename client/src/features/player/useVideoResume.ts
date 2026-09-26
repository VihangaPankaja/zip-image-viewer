import { useLayoutEffect, useRef, useState, type RefObject } from "react";

function readPosition(key: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : null;
  } catch {
    return null;
  }
}

function writePosition(key: string, position: number | null) {
  if (position === null) return;
  try {
    if (position > 0) localStorage.setItem(key, JSON.stringify(position));
    else localStorage.removeItem(key);
  } catch {
    // Playback remains available when storage is disabled or full.
  }
}

function resumablePosition(video: HTMLVideoElement, time: number) {
  return Number.isFinite(video.duration) && video.duration - time <= 10
    ? 0
    : time;
}

function createResumeHandlers(
  video: HTMLVideoElement,
  key: string,
  setPosition: (position: number | null) => void,
) {
  let offered = readPosition(key);
  let snapshot: number | null = null;
  let pendingSeek: number | null = null;
  let ready = false;
  let lastWrite = 0;
  setPosition(offered);
  const write = () => {
    writePosition(key, snapshot);
    lastWrite = Date.now();
  };
  const capture = () => {
    if (
      !ready ||
      offered !== null ||
      pendingSeek !== null ||
      video.readyState < 1
    )
      return;
    const time = video.currentTime;
    if (Number.isFinite(time) && time >= 0)
      snapshot = resumablePosition(video, time);
  };
  const flush = () => {
    capture();
    write();
  };
  const clear = () => {
    offered = null;
    snapshot = 0;
    setPosition(null);
    write();
  };
  const metadata = () => {
    ready = true;
    if (offered !== null && resumablePosition(video, offered) === 0) clear();
    if (pendingSeek !== null) {
      snapshot = resumablePosition(video, pendingSeek);
      video.currentTime = snapshot;
      pendingSeek = null;
      write();
      void video.play().catch(() => {});
    }
  };
  const reset = () => {
    ready = false;
  };
  const events = {
    loadedmetadata: metadata,
    emptied: reset,
    loadstart: reset,
    timeupdate: () => {
      capture();
      if (Date.now() - lastWrite >= 5000) write();
    },
    pause: flush,
    playing: () => {
      if (offered !== null) {
        clear();
        flush();
      }
    },
    ended: clear,
  };
  const choose = (restart: boolean) => {
    pendingSeek = restart ? 0 : offered;
    offered = null;
    snapshot = pendingSeek;
    setPosition(null);
    write();
    if (ready && video.readyState >= 1) metadata();
  };
  return { events, choose, flush };
}

export function useVideoResume(
  videoRef: RefObject<HTMLVideoElement | null>,
  sessionId: string,
  path: string,
) {
  const [position, setPosition] = useState<number | null>(null);
  const chooseRef = useRef<(restart: boolean) => void>(() => {});
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const key = `video-resume:${JSON.stringify([sessionId, path])}`;
    const { events, choose, flush } = createResumeHandlers(
      video,
      key,
      setPosition,
    );
    chooseRef.current = choose;
    for (const [event, listener] of Object.entries(events))
      video.addEventListener(event, listener);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      for (const [event, listener] of Object.entries(events))
        video.removeEventListener(event, listener);
      window.removeEventListener("pagehide", flush);
    };
  }, [videoRef, sessionId, path]);
  return {
    position,
    continuePlayback: () => chooseRef.current(false),
    startOver: () => chooseRef.current(true),
  };
}
