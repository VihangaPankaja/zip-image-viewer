import crypto from "node:crypto";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import {
  queryText,
  requireTranscoder,
  resolveVideoContext,
  selectVideoQuality,
} from "./routeContext.js";
import { registerVideoStoryboardRoutes } from "./storyboardRoutes.js";
import type { VideoRouteDependencies } from "./types.js";

const pendingThumbnails = new Map<string, Promise<void>>();

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

export function registerVideoThumbnailRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  registerVideoStoryboardRoutes(app, deps);
  app.get("/api/sessions/:id/video/thumbnail", async (req, res) => {
    const context = await resolveVideoContext(req, res, deps);
    const ffmpegPath = context && requireTranscoder(res, deps);
    if (!context || !ffmpegPath) return;
    const seekSeconds = deps.parseSeekSeconds(req.query.time);
    const quality = queryText(req.query.quality, "720p").toLowerCase();
    const requestedWidth =
      Number.parseInt(queryText(req.query.width, "240"), 10) || 240;
    const width = Math.max(120, Math.min(640, requestedWidth));
    const source = await deps.getVideoMetadata(
      context.targetPath,
      context.session,
    );
    const { options } = deps.buildVideoQualityOptions(source.height);
    const selected = selectVideoQuality(options, quality);
    const thumbDir = path.join(
      context.session.workspaceDir,
      "video-thumbnails",
    );
    const lastSeek =
      source.durationSeconds > 0
        ? Math.max(0, Math.ceil(source.durationSeconds * 4) - 1) / 4
        : Infinity;
    const roundedSeek = Math.min(
      lastSeek,
      Math.max(0, Math.round(seekSeconds * 4) / 4),
    );
    const hash = crypto
      .createHash("sha1")
      .update(
        `${context.normalizedPath}:${selected.quality}:${String(width)}:${String(roundedSeek)}`,
      )
      .digest("hex");
    const thumbPath = path.join(thumbDir, `${hash}.jpg`);
    if (!(await stat(thumbPath).catch(() => null))) {
      if (!deps.touchSession(context.session.id)) {
        res
          .status(404)
          .json({ error: "Session not found or already cleaned up." });
        return;
      }
      let generation = pendingThumbnails.get(thumbPath);
      if (!generation) {
        generation = deps
          .trackVideoTask(
            context.session,
            (async () => {
              await mkdir(thumbDir, { recursive: true });
              await deps.runCommand(
                ffmpegPath,
                buildThumbnailArgs(
                  context.targetPath,
                  `${thumbPath}.pending.jpg`,
                  roundedSeek,
                  width,
                  selected.height,
                ),
                context.session,
              );
              await rename(`${thumbPath}.pending.jpg`, thumbPath);
              await deps.enforceDerivedMediaBudget?.();
            })(),
          )
          .finally(() => pendingThumbnails.delete(thumbPath));
        pendingThumbnails.set(thumbPath, generation);
      }
      await generation;
    }
    res.setHeader("cache-control", "private, max-age=31536000, immutable");
    res.type("image/jpeg");
    res.sendFile(thumbPath);
  });
}
