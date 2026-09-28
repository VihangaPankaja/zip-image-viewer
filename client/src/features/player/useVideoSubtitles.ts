import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MAX_SUBTITLE_BYTES, normalizeSubtitles } from "./subtitles";

function shiftCue(
  cue: TextTrackCue,
  start: number,
  end: number,
  offset: number,
  track: TextTrack,
) {
  track.removeCue(cue);
  cue.startTime = Math.max(0, start + offset);
  cue.endTime = Math.max(0, end + offset);
  track.addCue(cue);
}

type SubtitleFile = { name: string; text: string };

function useSubtitleFile() {
  const request = useRef(0);
  const [file, setFile] = useState<SubtitleFile | null>(null);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );
  async function load(selected: File) {
    const current = ++request.current;
    setError("");
    try {
      const extension = selected.name.split(".").pop()?.toLowerCase();
      if (extension !== "vtt" && extension !== "srt")
        throw new Error("Choose a .vtt or .srt subtitle file.");
      if (selected.size > MAX_SUBTITLE_BYTES)
        throw new Error("Subtitle files must be 2 MB or smaller.");
      const text = normalizeSubtitles(await selected.text(), extension);
      if (current === request.current) setFile({ name: selected.name, text });
    } catch (cause) {
      if (current === request.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Subtitles could not be read. Try another file.",
        );
    }
  }
  function remove() {
    request.current += 1;
    setFile(null);
    setError("");
  }
  const fail = useCallback((message: string) => {
    setFile(null);
    setError(message);
  }, []);
  return { file, error, fail, load, remove };
}

function useNativeSubtitleTrack(
  videoRef: RefObject<HTMLVideoElement | null>,
  file: SubtitleFile | null,
  onError: (message: string) => void,
) {
  const trackRef = useRef<HTMLTrackElement | null>(null);
  const originalTimes = useRef<
    { cue: TextTrackCue; start: number; end: number }[]
  >([]);
  const [enabled, setEnabled] = useState(true);
  const [offset, setOffset] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    setOffset(0);
    setEnabled(true);
    const video = videoRef.current;
    if (!video || !file) return;
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = file.name;
    const url = URL.createObjectURL(
      new Blob([file.text], { type: "text/vtt" }),
    );
    track.src = url;
    trackRef.current = track;
    const onLoad = () => {
      const cues = Array.from(track.track.cues ?? []);
      if (!cues.length) {
        onError("No readable subtitle cues. Choose another file.");
        return;
      }
      originalTimes.current = cues.map((cue) => ({
        cue,
        start: cue.startTime,
        end: cue.endTime,
      }));
      track.track.mode = "showing";
      setEnabled(true);
      setReady(true);
    };
    const failed = () =>
      onError("Subtitles could not be loaded. Choose another file.");
    const onChange = () => setEnabled(track.track.mode === "showing");
    track.addEventListener("load", onLoad);
    track.addEventListener("error", failed);
    video.appendChild(track);
    track.track.mode = "hidden";
    video.textTracks.addEventListener("change", onChange);
    return () => {
      track.removeEventListener("load", onLoad);
      track.removeEventListener("error", failed);
      video.textTracks.removeEventListener("change", onChange);
      track.track.mode = "disabled";
      track.remove();
      URL.revokeObjectURL(url);
      trackRef.current = null;
      originalTimes.current = [];
    };
  }, [file, videoRef, onError]);
  useEffect(() => {
    const track = trackRef.current;
    if (ready && track) track.track.mode = enabled ? "showing" : "disabled";
  }, [enabled, ready]);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    for (const { cue, start, end } of originalTimes.current) {
      shiftCue(cue, start, end, offset, track.track);
    }
  }, [offset, ready]);
  return { ready, enabled, setEnabled, offset, setOffset };
}

export function useVideoSubtitles(
  videoRef: RefObject<HTMLVideoElement | null>,
) {
  const subtitles = useSubtitleFile();
  const track = useNativeSubtitleTrack(
    videoRef,
    subtitles.file,
    subtitles.fail,
  );
  const [size, setSize] = useState("medium");
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.dataset.captionSize = size;
    return () => {
      delete video.dataset.captionSize;
    };
  }, [size, videoRef]);
  return { ...subtitles, ...track, size, setSize };
}
