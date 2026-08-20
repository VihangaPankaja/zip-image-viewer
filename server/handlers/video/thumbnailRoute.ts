import crypto from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Express, RequestHandler } from "express";
import {
  queryText,
  requireTranscoder,
  resolveVideoFileContext,
  resolveVideoSession,
} from "./routeContext.js";
import type { VideoRouteDependencies } from "./types.js";

function buildThumbnailArgs(
  targetPath: string,
  outputPath: string,
  seekSeconds: number,
  width: number,
  selectedHeight: number,
): string[] {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(seekSeconds),
    "-i",
    targetPath,
  ];
  const scale =
    selectedHeight > 0
      ? `scale=-2:${String(selectedHeight)},scale=${String(width)}:-2`
      : `scale=${String(width)}:-2`;
  args.push("-vf", scale, "-frames:v", "1", "-q:v", "4", outputPath);
  return args;
}

function createThumbnailHandler(deps: VideoRouteDependencies): RequestHandler {
  return async (req, res) => {
    const session = resolveVideoSession(req, res, deps);
    if (!session) return;
    const ffmpegPath = requireTranscoder(res, deps);
    if (!ffmpegPath) return;
    const context = await resolveVideoFileContext(req, res, deps, session);
    if (!context) return;
    const seekSeconds = deps.parseSeekSeconds(req.query.time);
    const quality = queryText(req.query.quality, "720p").toLowerCase();
    const requestedWidth =
      Number.parseInt(queryText(req.query.width, "240"), 10) || 240;
    const width = Math.max(120, Math.min(640, requestedWidth));
    const source = await deps.getVideoMetadata(context.targetPath);
    const { options } = deps.buildVideoQualityOptions(source.height);
    const selectedQuality =
      options.find(({ id }) => id === quality)?.id || "source";
    const selectedHeight =
      selectedQuality === "source"
        ? 0
        : Number.parseInt(selectedQuality.replace("p", ""), 10) || 0;
    const thumbDir = path.join(session.workspaceDir, "video-thumbnails");
    await mkdir(thumbDir, { recursive: true });
    const roundedSeek = Math.max(0, Math.round(seekSeconds * 4) / 4);
    const hash = crypto
      .createHash("sha1")
      .update(
        `${context.normalizedPath}:${selectedQuality}:${String(width)}:${String(roundedSeek)}`,
      )
      .digest("hex");
    const thumbPath = path.join(thumbDir, `${hash}.jpg`);
    if (!(await stat(thumbPath).catch(() => null))) {
      await deps.runCommand(
        ffmpegPath,
        buildThumbnailArgs(
          context.targetPath,
          thumbPath,
          roundedSeek,
          width,
          selectedHeight,
        ),
      );
    }
    res.setHeader("cache-control", "no-store");
    res.type("image/jpeg");
    res.sendFile(thumbPath);
  };
}

export function registerVideoThumbnailRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/thumbnail", createThumbnailHandler(deps));
}
