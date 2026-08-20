import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import type { Express, Request } from "express";
import { ApplicationError, type Session } from "../domain/models.js";
import {
  buildMasterPlaylist,
  buildVariantPlaylist,
} from "../media/hlsManifest.js";
import type { VideoRouteDependencies } from "./videoRoutes.js";

type VideoContext = {
  session: Session;
  normalizedPath: string;
  targetPath: string;
};

function queryText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return fallback;
}

async function resolveVideoContext(
  deps: VideoRouteDependencies,
  sessionId: string,
  requestedPath: unknown,
): Promise<VideoContext> {
  const session = deps.touchSession(sessionId);
  if (!session)
    throw new ApplicationError("NOT_FOUND", "Session not found.", 404);
  const rawPath = queryText(requestedPath);
  if (!rawPath || rawPath === ".") {
    throw new ApplicationError("INVALID_INPUT", "File path is required.", 400);
  }
  let normalizedPath: string;
  try {
    normalizedPath = deps.sanitizeEntryPath(rawPath);
  } catch (error) {
    throw new ApplicationError("INVALID_INPUT", "Invalid file path.", 400, {
      cause: error,
    });
  }
  const targetPath = path.resolve(session.extractDir, normalizedPath);
  const rootPath = path.resolve(session.extractDir);
  if (!targetPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new ApplicationError("INVALID_INPUT", "Invalid file path.", 400);
  }
  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new ApplicationError("NOT_FOUND", "File not found.", 404);
  }
  return { session, normalizedPath, targetPath };
}

function renditionUri(
  request: Request,
  context: VideoContext,
  quality: string,
  resource: "playlist" | "init" | "segment",
  index?: number,
): string {
  const query = new URLSearchParams({
    path: context.normalizedPath,
    quality,
  });
  if (index !== undefined) query.set("index", String(index));
  return `/api/sessions/${queryText(request.params.id)}/video/hls/${resource}?${query.toString()}`;
}

function requireTranscoder(deps: VideoRouteDependencies): void {
  if (!deps.ffmpegPath) {
    throw new ApplicationError(
      "INTERNAL_ERROR",
      "Video transcoder is unavailable.",
      503,
    );
  }
}

function registerMasterRoute(app: Express, deps: VideoRouteDependencies): void {
  app.get("/api/sessions/:id/video/hls/master", async (request, response) => {
    requireTranscoder(deps);
    const context = await resolveVideoContext(
      deps,
      request.params.id,
      request.query.path,
    );
    const entry = await deps.ensureVideoTranscodeEntry(
      context.session,
      context.normalizedPath,
      context.targetPath,
    );
    const renditions = entry.qualities.map((quality) => ({
      id: quality.id,
      height: quality.height ?? entry.height,
      width: Math.max(
        2,
        Math.round(
          (entry.width * (quality.height ?? entry.height)) /
            Math.max(1, entry.height) /
            2,
        ) * 2,
      ),
      bandwidth:
        quality.id === "source"
          ? 14_000_000
          : Math.max(600_000, (quality.height ?? 360) * 4_000),
    }));
    const playlist = buildMasterPlaylist(renditions, ({ id }) =>
      renditionUri(request, context, id, "playlist"),
    );
    response.type("application/vnd.apple.mpegurl").send(playlist);
  });
}

function registerVariantRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/hls/playlist", async (request, response) => {
    requireTranscoder(deps);
    const context = await resolveVideoContext(
      deps,
      request.params.id,
      request.query.path,
    );
    const entry = await deps.ensureVideoTranscodeEntry(
      context.session,
      context.normalizedPath,
      context.targetPath,
    );
    const requested = queryText(
      request.query.quality,
      entry.defaultQuality,
    ).toLowerCase();
    const quality = entry.qualities.some(({ id }) => id === requested)
      ? requested
      : entry.defaultQuality;
    const rendition = deps.getRenditionState(entry, context.session, quality);
    await deps.startRenditionTranscode(entry, context.session, rendition);
    await deps.refreshRenditionAvailability(rendition);
    const playlist = buildVariantPlaylist({
      availableSegments: rendition.availableSegments,
      complete: rendition.status === "done",
      durationSeconds: entry.durationSeconds,
      segmentDurationSeconds: deps.DEFAULT_VIDEO_SEGMENT_SECONDS,
    })
      .replace("init.mp4", renditionUri(request, context, quality, "init"))
      .replace(/segment_(\d+)\.m4s/g, (_match, digits: string) =>
        renditionUri(
          request,
          context,
          quality,
          "segment",
          Number.parseInt(digits, 10),
        ),
      );
    response.type("application/vnd.apple.mpegurl").send(playlist);
  });
}

function registerInitRoute(app: Express, deps: VideoRouteDependencies): void {
  app.get("/api/sessions/:id/video/hls/init", async (request, response) => {
    requireTranscoder(deps);
    const context = await resolveVideoContext(
      deps,
      request.params.id,
      request.query.path,
    );
    const entry = await deps.ensureVideoTranscodeEntry(
      context.session,
      context.normalizedPath,
      context.targetPath,
    );
    const quality = queryText(
      request.query.quality,
      entry.defaultQuality,
    ).toLowerCase();
    const rendition = deps.getRenditionState(entry, context.session, quality);
    await deps.startRenditionTranscode(entry, context.session, rendition);
    const initPath = path.join(rendition.dir, "init.mp4");
    if (!(await deps.waitForFile(initPath, 14_000))) {
      return response
        .status(425)
        .json({ error: "Rendition is being prepared." });
    }
    response.type("video/mp4");
    return createReadStream(initPath).pipe(response);
  });
}

function registerSegmentRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/hls/segment", async (request, response) => {
    requireTranscoder(deps);
    const context = await resolveVideoContext(
      deps,
      request.params.id,
      request.query.path,
    );
    const entry = await deps.ensureVideoTranscodeEntry(
      context.session,
      context.normalizedPath,
      context.targetPath,
    );
    const quality = queryText(
      request.query.quality,
      entry.defaultQuality,
    ).toLowerCase();
    const index = Math.max(
      0,
      Number.parseInt(queryText(request.query.index, "0"), 10) || 0,
    );
    const rendition = deps.getRenditionState(entry, context.session, quality);
    await deps.startRenditionTranscode(entry, context.session, rendition);
    const segmentPath = path.join(
      rendition.dir,
      `segment_${String(index).padStart(6, "0")}.m4s`,
    );
    const exists = await access(segmentPath)
      .then(() => true)
      .catch(() => false);
    if (!exists && !(await deps.waitForFile(segmentPath, 14_000))) {
      return response.status(425).json({ error: "Segment is being prepared." });
    }
    response.type("video/iso.segment");
    return createReadStream(segmentPath).pipe(response);
  });
}

export function registerVideoHlsRoutes(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  registerMasterRoute(app, deps);
  registerVariantRoute(app, deps);
  registerInitRoute(app, deps);
  registerSegmentRoute(app, deps);
}
