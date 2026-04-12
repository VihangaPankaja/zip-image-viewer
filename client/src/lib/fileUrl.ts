import { STRIP_THUMB_SIZE } from "./appConstants";
import type { BuildFileUrlOptions } from "../types/download";

export function buildFileUrl(
  sessionId: string,
  filePath: string,
  options: BuildFileUrlOptions = {},
): string {
  if (!sessionId || !filePath) {
    return "";
  }

  const params = new URLSearchParams({ path: filePath });
  if (options.previewText) {
    params.set("preview", "1");
  }
  if (options.thumbnail) {
    params.set("thumbnail", "1");
    params.set("size", String(options.size || STRIP_THUMB_SIZE));
  }
  if (options.imagePreview) {
    params.set("imagePreview", "1");
    params.set("quality", options.quality || "balanced");
  }

  return `/api/sessions/${sessionId}/file?${params.toString()}`;
}
