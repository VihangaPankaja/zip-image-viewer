import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import mime from "mime-types";
import type { Express, RequestHandler, Response } from "express";
import { applyByteRange } from "../httpUtils.js";
import { queryText, resolveVideoContext } from "./routeContext.js";
import type { VideoRouteDependencies } from "./types.js";

function pipeVideo(
  res: Response,
  deps: VideoRouteDependencies,
  targetPath: string,
  size: number,
  rangeHeader: string | undefined,
): void {
  const range = applyByteRange(
    res,
    deps.parseRangeHeader(rangeHeader, size),
    size,
  );
  if (range === null) return;
  createReadStream(targetPath, range).pipe(res);
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
    if (quality === "remux") {
      const metadata = await deps.getVideoMetadata(
        context.targetPath,
        context.session,
      );
      if (metadata.playbackMode !== "remux") {
        res.status(400).json({ error: "This video does not need a remux." });
        return;
      }
      try {
        targetPath = await deps.prepareVideoRemux(
          context.session,
          context.normalizedPath,
          context.targetPath,
        );
      } catch {
        res
          .status(503)
          .json({ error: "Video remux failed. Try Auto playback." });
        return;
      }
      targetStats = await stat(targetPath);
      sourceMode = "remux";
    } else if (quality !== "source") {
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
    } else if (
      (await deps.getVideoMetadata(context.targetPath, context.session))
        .playbackMode === "direct"
    ) {
      sourceMode = "direct";
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
