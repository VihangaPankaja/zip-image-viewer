import type { VideoQualityOption } from "../domain/models.js";
import type { VideoMediaTrack } from "../../shared/contracts.js";
import { calculateRenditions } from "./hlsManifest.js";
export type VideoMetadata = {
  width: number;
  height: number;
  durationSeconds: number;
  playbackMode?: VideoPlaybackMode;
  audioTracks?: VideoMediaTrack[];
  subtitleTracks?: VideoMediaTrack[];
};
export type VideoPlaybackMode = "direct" | "remux" | "transcode";

const TEXT_SUBTITLE_CODECS = new Set(["subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text"]);
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function mediaTracksFromOutput(output: string): {
  audioTracks: VideoMediaTrack[];
  subtitleTracks: VideoMediaTrack[];
} {
  const audioTracks: VideoMediaTrack[] = [];
  const subtitleTracks: VideoMediaTrack[] = [];
  let current: VideoMediaTrack | undefined;
  for (const line of output.split(/\r?\n/)) {
    const stream =
      /^\s*Stream #0:(\d+)(?:\[[^\]]*\])?(?:\(([^)]+)\))?:\s*(Audio|Subtitle):\s*([\w]+)/.exec(
        line,
      );
    if (stream) {
      current = undefined;
      const [, streamIndex, rawLanguage, kind, codec] = stream;
      if (kind === "Subtitle" && !TEXT_SUBTITLE_CODECS.has(codec)) continue;
      const tracks = kind === "Audio" ? audioTracks : subtitleTracks;
      let language =
        rawLanguage && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(rawLanguage)
          ? rawLanguage.toLowerCase()
          : "und";
      let name: string | undefined;
      try {
        if (language !== "und") name = languageNames.of(language);
      } catch {
        language = "und";
      }
      current = {
        id: `${kind === "Audio" ? "audio" : "subtitle"}-${streamIndex}`,
        index: Number(streamIndex),
        language,
        label: name ?? `${kind} ${String(tracks.length + 1)}`,
        isDefault: line.includes("(default)"),
      };
      tracks.push(current);
    } else if (/^\s*Stream #/.test(line)) {
      current = undefined;
    } else if (current) {
      const title = /^\s*title\s*:\s*(.+)$/i.exec(line)?.[1]?.trim();
      if (title && !/[\\/]/.test(title)) {
        const label = title
          .replace(/[\p{Cc}"<>]/gu, "")
          .slice(0, 120)
          .trim();
        if (label) current.label = label;
      }
    }
  }
  return { audioTracks, subtitleTracks };
}

export function videoMetadataFromOutput(output: string, extension: string): VideoMetadata {
  return {
    ...dimensionsFromOutput(output),
    ...mediaTracksFromOutput(output),
    durationSeconds: durationFromOutput(output),
    playbackMode: playbackModeFromOutput(output, extension),
  };
}

export function playbackModeFromOutput(output: string, extension: string): VideoPlaybackMode {
  const streams = output.split(/\r?\n/);
  const video = streams.find((line) => /Stream #\d+:\d+.*Video:/.test(line));
  const audio = streams.filter((line) => /Stream #\d+:\d+.*Audio:/.test(line));
  if (
    !video ||
    !/Video:\s*h264\b/.test(video) ||
    !/\byuv420p\b/.test(video) ||
    audio.some((line) => !/Audio:\s*aac \(LC\)/.test(line))
  )
    return "transcode";
  const mp4 = /Input #0, (?:mov,mp4|mp4|mov),/.test(output);
  return mp4 && ["mp4", "m4v"].includes(extension) ? "direct" : "remux";
}
export function durationFromOutput(output: string): number {
  const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return 0;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseFloat(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

export function dimensionsFromOutput(output: string): {
  width: number;
  height: number;
} {
  const videoLine = output.split(/\r?\n/).find((line) => line.includes("Video:"));
  const match = videoLine?.match(/\b(\d{2,5})x(\d{2,5})\b/);
  return {
    width: Number.parseInt(match?.[1] ?? "0", 10),
    height: Number.parseInt(match?.[2] ?? "0", 10),
  };
}

export function qualityOptions(metadata: VideoMetadata): {
  options: VideoQualityOption[];
  defaultQuality: string;
} {
  const options: VideoQualityOption[] = [
    { id: "source", label: "Original", height: metadata.height },
    ...(metadata.height > 0 ? [{ id: "auto", label: "Auto", height: null }] : []),
    ...calculateRenditions(metadata)
      .filter(({ id }) => id !== "source")
      .map(({ id, height }) => ({ id, label: id, height })),
  ];
  return {
    options,
    defaultQuality: options.some(({ id }) => id === "720p")
      ? "720p"
      : options[options.length - 1].id,
  };
}

export function buildVideoQualityOptions(sourceHeight: number) {
  return qualityOptions({
    width: sourceHeight,
    height: sourceHeight,
    durationSeconds: 0,
  });
}
