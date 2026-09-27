import type { VideoQualityOption } from "../domain/models.js";
import { calculateRenditions } from "./hlsManifest.js";
type VideoMetadata = { width: number; height: number; durationSeconds: number };
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
  const videoLine = output
    .split(/\r?\n/)
    .find((line) => line.includes("Video:"));
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
