import path from "node:path";
import mime from "mime-types";
import type { Express, RequestHandler } from "express";
import { queryText, resolveVideoContext } from "./routeContext.js";
import type { VideoRouteDependencies } from "./types.js";

function createQualitiesHandler(deps: VideoRouteDependencies): RequestHandler {
  return async (req, res) => {
    const context = await resolveVideoContext(req, res, deps);
    if (!context) return;
    const contentType =
      mime.lookup(context.targetPath) || "application/octet-stream";
    const extension = path.extname(context.targetPath).slice(1).toLowerCase();
    if (
      !contentType.startsWith("video/") &&
      !deps.VIDEO_EXTENSIONS.has(extension)
    ) {
      res.status(400).json({ error: "Selected file is not a video." });
      return;
    }
    const source = await deps.getVideoMetadata(context.targetPath);
    const qualityConfig = deps.buildVideoQualityOptions(source.height);
    const preferredQuality =
      context.session.selectedVideoQuality || qualityConfig.defaultQuality;
    const defaultQuality =
      qualityConfig.options.find(({ id }) => id === preferredQuality)?.id ||
      qualityConfig.defaultQuality;
    res.json({
      path: context.normalizedPath,
      source,
      options: qualityConfig.options,
      defaultQuality,
    });
  };
}

function createHlsStatusHandler(deps: VideoRouteDependencies): RequestHandler {
  return async (req, res) => {
    const session = deps.touchSession(queryText(req.params.id));
    if (!session) {
      res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
      return;
    }
    const requestedPath = queryText(req.query.path);
    if (!requestedPath || requestedPath === ".") {
      res.status(400).json({ error: "File path is required." });
      return;
    }
    let normalizedPath: string;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected video error.";
      res.status(400).json({ error: message });
      return;
    }
    const entry = deps.videoTranscodeStore.get(
      deps.getVideoTranscodeKey(session.id, normalizedPath),
    );
    if (!entry) {
      res.json({
        path: normalizedPath,
        status: "idle",
        durationSeconds: 0,
        renditions: [],
      });
      return;
    }
    const renditions = [];
    for (const [quality, rendition] of entry.renditions.entries()) {
      renditions.push({
        quality,
        status: rendition.status,
        availableSegments: await deps.refreshRenditionAvailability(rendition),
        expectedSegments: rendition.expectedSegments,
      });
    }
    res.json({
      path: normalizedPath,
      status: renditions.some(({ status }) => status === "running")
        ? "running"
        : renditions.some(({ status }) => status === "done")
          ? "ready"
          : "idle",
      durationSeconds: entry.durationSeconds,
      renditions,
    });
  };
}

export function registerVideoMetadataRoutes(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/qualities", createQualitiesHandler(deps));
  app.get("/api/sessions/:id/video/hls/status", createHlsStatusHandler(deps));
}
