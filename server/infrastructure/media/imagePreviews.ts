import { mkdir, open, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import {
  MAX_THUMBNAIL_SIZE,
  TEXT_PREVIEW_LIMIT,
} from "../../config/runtimeConstants.js";
import type { Session } from "../../domain/models.js";

const PROFILES = {
  low: { size: 1280, quality: 58 },
  balanced: { size: 1920, quality: 72 },
  high: { size: 2560, quality: 82 },
} as const;
type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;

export async function readPreviewChunk(targetPath: string): Promise<Buffer> {
  const fileHandle = await open(targetPath, "r");
  try {
    const buffer = Buffer.alloc(TEXT_PREVIEW_LIMIT);
    const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

function numericSize(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 220;
}

export async function ensureThumbnail(
  session: Session,
  normalizedPath: string,
  targetPath: string,
  size: unknown,
  logEvent: LogEvent,
): Promise<string> {
  const requestedSize = numericSize(size);
  const safeSize = Math.max(
    48,
    Math.min(
      Number.isFinite(requestedSize) ? requestedSize : 220,
      MAX_THUMBNAIL_SIZE,
    ),
  );
  const hash = crypto
    .createHash("sha1")
    .update(`${normalizedPath}:${String(safeSize)}`)
    .digest("hex");
  const thumbnailDir = path.join(session.workspaceDir, "thumbnails");
  const thumbnailPath = path.join(thumbnailDir, `${hash}.jpg`);
  await mkdir(thumbnailDir, { recursive: true });
  if (!(await stat(thumbnailPath).catch(() => null))) {
    await sharp(targetPath)
      .rotate()
      .resize({
        width: safeSize,
        height: safeSize,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 55, mozjpeg: true })
      .toFile(thumbnailPath);
    logEvent("info", "session.thumbnail.generated", {
      sessionId: session.id,
      path: normalizedPath,
      size: safeSize,
      thumbnailPath,
    });
  }
  return thumbnailPath;
}

export async function ensureImagePreview(
  session: Session,
  normalizedPath: string,
  targetPath: string,
  profileName: string,
  logEvent: LogEvent,
): Promise<string> {
  const safeName =
    profileName in PROFILES
      ? (profileName as keyof typeof PROFILES)
      : "balanced";
  const profile = PROFILES[safeName];
  const hash = crypto
    .createHash("sha1")
    .update(
      `${normalizedPath}:${safeName}:${String(profile.size)}:${String(profile.quality)}`,
    )
    .digest("hex");
  const previewDir = path.join(session.workspaceDir, "previews");
  const previewPath = path.join(previewDir, `${hash}.jpg`);
  await mkdir(previewDir, { recursive: true });
  if (!(await stat(previewPath).catch(() => null))) {
    await sharp(targetPath)
      .rotate()
      .resize({
        width: profile.size,
        height: profile.size,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#f7f3eb" })
      .jpeg({
        quality: profile.quality,
        mozjpeg: true,
        chromaSubsampling: "4:2:0",
      })
      .toFile(previewPath);
    logEvent("info", "session.image_preview.generated", {
      sessionId: session.id,
      path: normalizedPath,
      profile: safeName,
      previewPath,
    });
  }
  return previewPath;
}
