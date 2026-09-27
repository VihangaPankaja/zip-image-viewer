import path from "node:path";
import mime from "mime-types";
import type { Express, RequestHandler } from "express";
import type {
  VideoQualities,
  VideoQualitiesInput,
} from "../../../shared/contracts.js";
import { ApplicationError } from "../../domain/models.js";
import { queryText, resolveVideoFile } from "./routeContext.js";
import type { VideoRouteDependencies } from "./types.js";

export async function getVideoQualities(
  input: VideoQualitiesInput,
  deps: Pick<
    VideoRouteDependencies,
    | "touchSession"
    | "sanitizeEntryPath"
    | "VIDEO_EXTENSIONS"
    | "getVideoMetadata"
    | "buildVideoQualityOptions"
  >,
): Promise<VideoQualities> {
  const context = await resolveVideoFile(input.sessionId, input.path, deps);
  const contentType =
    mime.lookup(context.targetPath) || "application/octet-stream";
  const extension = path.extname(context.targetPath).slice(1).toLowerCase();
  if (
    !contentType.startsWith("video/") &&
    !deps.VIDEO_EXTENSIONS.has(extension)
  ) {
    throw new ApplicationError(
      "INVALID_INPUT",
      "Selected file is not a video.",
      400,
    );
  }
  const source = await deps.getVideoMetadata(
    context.targetPath,
    context.session,
  );
  const qualityConfig = deps.buildVideoQualityOptions(source.height);
  const preferredQuality =
    context.session.selectedVideoQuality || qualityConfig.defaultQuality;
  const defaultQuality =
    qualityConfig.options.find(({ id }) => id === preferredQuality)?.id ||
    qualityConfig.defaultQuality;
  return {
    path: context.normalizedPath,
    source,
    options: qualityConfig.options,
    defaultQuality,
  };
}

function createQualitiesHandler(deps: VideoRouteDependencies): RequestHandler {
  return async (req, res) => {
    try {
      res.json(
        await getVideoQualities(
          {
            sessionId: queryText(req.params.id),
            path: queryText(req.query.path),
          },
          deps,
        ),
      );
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      res.status(error.status).json({ error: error.message });
    }
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
        encoderWaitMs:
          rendition.encoderWaitMs ??
          (rendition.queuedAt ? Date.now() - rendition.queuedAt : null),
      });
    }
    res.json({
      path: normalizedPath,
      status: renditions.some(({ status }) => status === "running")
        ? "running"
        : renditions.some(({ status }) => status === "queued")
          ? "queued"
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
