import crypto from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import {
  queryText,
  requireTranscoder,
  resolveVideoContext,
  selectVideoQuality,
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

export function registerVideoThumbnailRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/thumbnail", async (req, res) => {
    const context = await resolveVideoContext(req, res, deps);
    const ffmpegPath = context && requireTranscoder(res, deps);
    if (!context || !ffmpegPath) return;
    const seekSeconds = deps.parseSeekSeconds(req.query.time);
    const quality = queryText(req.query.quality, "720p").toLowerCase();
    const requestedWidth =
      Number.parseInt(queryText(req.query.width, "240"), 10) || 240;
    const width = Math.max(120, Math.min(640, requestedWidth));
    const source = await deps.getVideoMetadata(context.targetPath);
    const { options } = deps.buildVideoQualityOptions(source.height);
    const selected = selectVideoQuality(options, quality);
    const thumbDir = path.join(
      context.session.workspaceDir,
      "video-thumbnails",
    );
    await mkdir(thumbDir, { recursive: true });
    const roundedSeek = Math.max(0, Math.round(seekSeconds * 4) / 4);
    const hash = crypto
      .createHash("sha1")
      .update(
        `${context.normalizedPath}:${selected.quality}:${String(width)}:${String(roundedSeek)}`,
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
          selected.height,
        ),
      );
    }
    res.setHeader("cache-control", "no-store");
    res.type("image/jpeg");
    res.sendFile(thumbPath);
  });
}
