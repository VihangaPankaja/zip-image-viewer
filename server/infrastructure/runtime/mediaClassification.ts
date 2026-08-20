import path from "node:path";
import mime from "mime-types";
import type { FileTypeResult } from "file-type";

const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
]);
export const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "mov",
  "m4v",
  "ogv",
  "mkv",
]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "aac", "m4a", "flac"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorFromUnknown(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unexpected error");
}

export function sleepWithSignal(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isArchiveByName(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const name = value.toLowerCase();
  const extension = name.includes(".") ? name.split(".").pop() : undefined;
  return extension ? ARCHIVE_EXTENSIONS.has(extension) : false;
}

export function classifyDetectedType(
  filePath: string,
  detected: FileTypeResult | undefined,
): "archive" | "video" | "audio" | "image" | "text" | "binary" {
  const detectedMime = detected?.mime ?? (mime.lookup(filePath) || "");
  const mimeType = detectedMime || "";
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (
    isArchiveByName(filePath) ||
    ["zip", "rar", "7z", "tar", "compressed"].some((part) =>
      mimeType.includes(part),
    )
  )
    return "archive";
  if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return "text";
  }
  return "binary";
}

export function classifyMimeType(
  contentType: string,
): "image" | "text" | "binary" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("text/") || contentType === "application/json") {
    return "text";
  }
  return "binary";
}

export function shouldPreserveOriginalPreview(contentType: string): boolean {
  return contentType === "image/svg+xml" || contentType === "image/gif";
}

export function parseSeekSeconds(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(typeof value === "string" ? value : "0");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
