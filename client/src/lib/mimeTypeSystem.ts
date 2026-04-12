import type { FileNodeLike, PreviewKind } from "../types/preview";

export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "svg",
  "bmp",
  "avif",
]);

export const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "mov",
  "m4v",
  "ogv",
  "mkv",
]);
export const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "ogg",
  "aac",
  "m4a",
  "flac",
]);
export const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "csv",
  "log",
  "xml",
  "yml",
  "yaml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "html",
  "css",
]);

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

export function classifyExtension(
  extension: string | undefined | null,
): PreviewKind {
  const ext = String(extension || "").toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "binary";
}

export function classifyNodeKind(
  node: FileNodeLike | null | undefined,
): PreviewKind {
  if (!node || node.type === "directory") {
    return "directory";
  }
  return classifyExtension(node.extension);
}

export function getVideoMimeType(extension: string | undefined | null): string {
  const ext = String(extension || "").toLowerCase();
  return VIDEO_MIME_BY_EXTENSION[ext] || "video/mp4";
}
