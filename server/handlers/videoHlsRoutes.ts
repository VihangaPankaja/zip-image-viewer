import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Express, Request, Response } from "express";
import {
  ApplicationError,
  type Session,
  type VideoRendition,
  type VideoTranscodeEntry,
} from "../domain/models.js";
import { queryText } from "./httpUtils.js";
import {
  buildMasterPlaylist,
  buildVariantPlaylist,
  publishedSegments,
} from "../media/hlsManifest.js";
import type { VideoRouteDependencies } from "./videoRoutes.js";

type VideoContext = {
  session: Session;
  normalizedPath: string;
  targetPath: string;
};

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

async function resolveHlsEntry(
  request: Request,
  deps: VideoRouteDependencies,
): Promise<{ context: VideoContext; entry: VideoTranscodeEntry }> {
  requireTranscoder(deps);
  const context = await resolveVideoContext(
    deps,
    queryText(request.params.id),
    request.query.path,
  );
  const entry = await deps.ensureVideoTranscodeEntry(
    context.session,
    context.normalizedPath,
    context.targetPath,
  );
  return { context, entry };
}

async function startRendition(
  deps: VideoRouteDependencies,
  context: VideoContext,
  entry: VideoTranscodeEntry,
  quality: string,
): Promise<VideoRendition> {
  const rendition = deps.getRenditionState(entry, context.session, quality);
  await deps.startRenditionTranscode(entry, context.session, rendition);
  return rendition;
}

async function readRenditionPlaylist(
  rendition: VideoRendition,
): Promise<string> {
  return readFile(rendition.playlistPath, "utf8").catch(() => "");
}

async function waitForPublishedSegment(
  rendition: VideoRendition,
  index: number,
): Promise<boolean> {
  const deadline = Date.now() + 14_000;
  do {
    if (
      publishedSegments(await readRenditionPlaylist(rendition)).includes(index)
    )
      return true;
    if (rendition.status === "error" || rendition.status === "done")
      return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 160));
  } while (Date.now() < deadline);
  return false;
}

function sendCompletedFile(
  response: Response,
  filePath: string,
  contentType: string,
) {
  response.set("Cache-Control", "private, max-age=3600, immutable");
  response.type(contentType);
  response.sendFile(filePath, { cacheControl: false });
}

function registerMasterRoute(app: Express, deps: VideoRouteDependencies): void {
  app.get("/api/sessions/:id/video/hls/master", async (request, response) => {
    const { context, entry } = await resolveHlsEntry(request, deps);
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
    response.set("Cache-Control", "private, no-store");
    response.type("application/vnd.apple.mpegurl").send(playlist);
  });
}

function registerVariantRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/hls/playlist", async (request, response) => {
    const { context, entry } = await resolveHlsEntry(request, deps);
    const requested = queryText(
      request.query.quality,
      entry.defaultQuality,
    ).toLowerCase();
    const quality = entry.qualities.some(({ id }) => id === requested)
      ? requested
      : entry.defaultQuality;
    const rendition = await startRendition(deps, context, entry, quality);
    const source = await readRenditionPlaylist(rendition);
    const playlist = source
      ? buildVariantPlaylist(
          source,
          renditionUri(request, context, quality, "init"),
          (index) => renditionUri(request, context, quality, "segment", index),
        )
      : "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n";
    response.set("Cache-Control", "private, no-store");
    response.type("application/vnd.apple.mpegurl").send(playlist);
  });
}

function registerInitRoute(app: Express, deps: VideoRouteDependencies): void {
  app.get("/api/sessions/:id/video/hls/init", async (request, response) => {
    const { context, entry } = await resolveHlsEntry(request, deps);
    const quality = queryText(
      request.query.quality,
      entry.defaultQuality,
    ).toLowerCase();
    const rendition = await startRendition(deps, context, entry, quality);
    const initPath = path.join(rendition.dir, "init.mp4");
    if (!(await waitForPublishedSegment(rendition, 0))) {
      return response
        .status(425)
        .json({ error: "Rendition is being prepared." });
    }
    sendCompletedFile(response, initPath, "video/mp4");
  });
}

function registerSegmentRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/hls/segment", async (request, response) => {
    const { context, entry } = await resolveHlsEntry(request, deps);
    const quality = queryText(
      request.query.quality,
      entry.defaultQuality,
    ).toLowerCase();
    const index = Math.max(
      0,
      Number.parseInt(queryText(request.query.index, "0"), 10) || 0,
    );
    const rendition = await startRendition(deps, context, entry, quality);
    const segmentPath = path.join(
      rendition.dir,
      `segment_${String(index).padStart(6, "0")}.m4s`,
    );
    if (!(await waitForPublishedSegment(rendition, index))) {
      return response.status(425).json({ error: "Segment is being prepared." });
    }
    sendCompletedFile(response, segmentPath, "video/iso.segment");
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
