import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import mime from "mime-types";
import type { Express, RequestHandler, Response } from "express";
import { queryText, resolveVideoContext } from "./routeContext.js";
import type { VideoRouteDependencies } from "./types.js";

function pipeVideo(
  res: Response,
  deps: VideoRouteDependencies,
  targetPath: string,
  size: number,
  rangeHeader: string | undefined,
): void {
  const range = deps.parseRangeHeader(rangeHeader, size);
  if (range === "invalid") {
    res.setHeader("content-range", `bytes */${String(size)}`);
    res.status(416).end();
    return;
  }
  if (range) {
    const contentLength = range.end - range.start + 1;
    res.status(206);
    res.setHeader(
      "content-range",
      `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
    );
    res.setHeader("content-length", String(contentLength));
    createReadStream(targetPath, range).pipe(res);
    return;
  }
  res.setHeader("content-length", String(size));
  createReadStream(targetPath).pipe(res);
}

function createPlayHandler(deps: VideoRouteDependencies): RequestHandler {
  return async (req, res) => {
    const context = await resolveVideoContext(req, res, deps);
    if (!context) return;
    const quality = queryText(
      req.query.quality,
      context.session.selectedVideoQuality || "720p",
    ).toLowerCase();
    let targetPath = context.targetPath;
    let targetStats = context.fileStats;
    let sourceMode = "raw";
    if (quality !== "source") {
      const qualityPath = deps.getSessionQualityOutputPath(
        context.session,
        context.normalizedPath,
        quality,
      );
      const qualityStats = await stat(qualityPath).catch(() => null);
      if (qualityStats?.isFile()) {
        targetPath = qualityPath;
        targetStats = qualityStats;
        sourceMode = quality;
      }
    }
    res.setHeader("cache-control", "no-store");
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("x-video-source", sourceMode);
    res.type(mime.lookup(targetPath) || "video/mp4");
    pipeVideo(res, deps, targetPath, targetStats.size, req.headers.range);
  };
}

export function registerVideoPlaybackRoutes(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/play", createPlayHandler(deps));
  app.get("/api/sessions/:id/video/transcode-status", (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      return res.status(404).json({
        error: "Session not found or already cleaned up.",
      });
    }
    return res.json({
      ...session.transcodeStatus,
      quality: session.selectedVideoQuality || "720p",
    });
  });
}
