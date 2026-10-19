import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Express, Request, Response, ErrorRequestHandler } from "express";
import {
  ApplicationError,
  type VideoRendition,
  type VideoTranscodeEntry,
} from "../domain/models.js";
import { prepareHlsMaster } from "./video/hlsPreparation.js";
import {
  readRenditionPlaylist,
  sendPreparationStatus,
  waitForPublishedSegment,
} from "./video/hlsAvailability.js";
import { queryText } from "./httpUtils.js";
import {
  buildMasterPlaylist,
  buildVariantPlaylist,
  calculateRenditions,
  codecsFromInit,
} from "../media/hlsManifest.js";
import type { VideoRouteDependencies } from "./videoRoutes.js";
import { resolveVideoFile, type VideoContext } from "./video/routeContext.js";
import {
  buildWindowPlaylist,
  WINDOWED_AFTER_SECONDS,
  windowDirectory,
} from "../infrastructure/media/hlsWindows.js";

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
    throw new ApplicationError("INTERNAL_ERROR", "Video transcoder is unavailable.", 503);
  }
}

async function resolveHlsEntry(
  request: Request,
  deps: VideoRouteDependencies,
): Promise<{ context: VideoContext; entry: VideoTranscodeEntry }> {
  requireTranscoder(deps);
  const context = await resolveVideoFile(
    queryText(request.params.id),
    queryText(request.query.path),
    deps,
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
  if (
    !entry.qualities.some(({ id }) => id === quality && id !== "auto" && id !== "remux") &&
    !(
      (entry.audioTracks?.length ?? 0) > 1 &&
      entry.audioTracks?.some((track) => track.id === quality)
    )
  ) {
    throw new ApplicationError("INVALID_INPUT", "Unknown video or audio rendition.", 400);
  }
  const rendition = deps.getRenditionState(entry, context.session, quality);
  rendition.lastAccessedAt = Date.now();
  if (entry.durationSeconds <= WINDOWED_AFTER_SECONDS || !entry.durationSeconds) {
    const levels = calculateRenditions(entry);
    const level = levels.findIndex(({ id }) => id === quality);
    // The background lane is FIFO and runs one sequential video encoder at a time.
    for (const fallback of levels.slice(0, Math.max(0, level))) {
      const state = deps.getRenditionState(entry, context.session, fallback.id);
      state.lastAccessedAt = Date.now();
      await deps.startRenditionTranscode(entry, context.session, state);
    }
    await deps.startRenditionTranscode(entry, context.session, rendition);
  }
  return rendition;
}

function sendCompletedFile(response: Response, filePath: string, contentType: string) {
  response.set("Cache-Control", "private, max-age=3600, immutable");
  response.type(contentType);
  response.sendFile(filePath, { cacheControl: false });
}

function registerMasterRoute(app: Express, deps: VideoRouteDependencies): void {
  app.get("/api/sessions/:id/video/hls/master", async (request, response) => {
    const { context, entry } = await resolveHlsEntry(request, deps);
    if (!(await prepareHlsMaster(response, deps, context, entry))) return;
    const renditions = await Promise.all(
      calculateRenditions(entry).map(async (rendition) => {
        const state = deps.getRenditionState(entry, context.session, rendition.id);
        const init = await readFile(
          path.join(
            entry.durationSeconds > WINDOWED_AFTER_SECONDS ? windowDirectory(state, 0) : state.dir,
            "init.mp4",
          ),
        ).catch(() => null);
        return {
          ...rendition,
          codecs: init ? codecsFromInit(init) : undefined,
        };
      }),
    );
    // A partial CODECS ladder makes hls.js treat cold levels as incompatible.
    if (renditions.some(({ codecs }) => !codecs))
      for (const rendition of renditions) rendition.codecs = undefined;
    const playlist = buildMasterPlaylist(
      renditions,
      ({ id }) => renditionUri(request, context, id, "playlist"),
      entry.audioTracks,
      (track) => renditionUri(request, context, track.id, "playlist"),
    );
    response.set("Cache-Control", "private, no-store");
    response.type("application/vnd.apple.mpegurl").send(playlist);
  });
}

function registerVariantRoute(app: Express, deps: VideoRouteDependencies): void {
  app.get("/api/sessions/:id/video/hls/playlist", async (request, response) => {
    const { context, entry } = await resolveHlsEntry(request, deps);
    const requested = queryText(request.query.quality, entry.defaultQuality).toLowerCase();
    const quality = requested;
    const rendition = await startRendition(deps, context, entry, quality);
    if (entry.durationSeconds > WINDOWED_AFTER_SECONDS) {
      response.set("Cache-Control", "private, no-store");
      response.type("application/vnd.apple.mpegurl").send(
        buildWindowPlaylist(
          entry.durationSeconds,
          (index) => renditionUri(request, context, quality, "init", index),
          (index) => renditionUri(request, context, quality, "segment", index),
        ),
      );
      return;
    }
    // Native HLS waits for publication; HLS.js explicitly supports preparation retries.
    const timeout = request.get("X-HLS-Preparation-Retry") === "1" ? 2_000 : Infinity;
    const availability = await waitForPublishedSegment(rendition, 0, response, timeout);
    if (availability !== "ready") return sendPreparationStatus(response, availability);
    const playlist = buildVariantPlaylist(
      await readRenditionPlaylist(rendition),
      renditionUri(request, context, quality, "init"),
      (index) => renditionUri(request, context, quality, "segment", index),
    );
    response.set("Cache-Control", "private, no-store");
    response.type("application/vnd.apple.mpegurl").send(playlist);
  });
}

function registerInitRoute(app: Express, deps: VideoRouteDependencies): void {
  app.get("/api/sessions/:id/video/hls/init", async (request, response) => {
    const { context, entry } = await resolveHlsEntry(request, deps);
    const quality = queryText(request.query.quality, entry.defaultQuality).toLowerCase();
    const rendition = await startRendition(deps, context, entry, quality);
    if (entry.durationSeconds > WINDOWED_AFTER_SECONDS) {
      await sendWindowResource(
        request,
        response,
        deps,
        context,
        entry,
        rendition,
        "init.mp4",
        "video/mp4",
      );
      return;
    }
    const initPath = path.join(rendition.dir, "init.mp4");
    const availability = await waitForPublishedSegment(rendition, 0, response);
    if (availability !== "ready") {
      return sendPreparationStatus(response, availability);
    }
    sendCompletedFile(response, initPath, "video/mp4");
  });
}

function registerSegmentRoute(app: Express, deps: VideoRouteDependencies): void {
  app.get("/api/sessions/:id/video/hls/segment", async (request, response) => {
    const { context, entry } = await resolveHlsEntry(request, deps);
    const quality = queryText(request.query.quality, entry.defaultQuality).toLowerCase();
    const index = Math.max(0, Number.parseInt(queryText(request.query.index, "0"), 10) || 0);
    const rendition = await startRendition(deps, context, entry, quality);
    if (entry.durationSeconds > WINDOWED_AFTER_SECONDS) {
      await sendWindowResource(
        request,
        response,
        deps,
        context,
        entry,
        rendition,
        undefined,
        "video/iso.segment",
      );
      return;
    }
    const segmentPath = path.join(rendition.dir, `segment_${String(index).padStart(6, "0")}.m4s`);
    const availability = await waitForPublishedSegment(rendition, index, response);
    if (availability !== "ready") {
      return sendPreparationStatus(response, availability);
    }
    sendCompletedFile(response, segmentPath, "video/iso.segment");
  });
}

async function sendWindowResource(
  request: Request,
  response: Response,
  deps: VideoRouteDependencies,
  context: VideoContext,
  entry: VideoTranscodeEntry,
  rendition: VideoRendition,
  filename: string | undefined,
  contentType: string,
): Promise<void> {
  const raw = queryText(request.query.index, "0");
  const index = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(index) || index >= entry.expectedSegments)
    throw new ApplicationError("INVALID_INPUT", "Segment index is outside the video.", 400);
  const controller = new AbortController();
  const close = () => controller.abort();
  response.once("close", close);
  try {
    await deps.startPrioritySegmentWindow(
      entry,
      context.session,
      rendition,
      index,
      controller.signal,
    );
    if (response.destroyed) return;
    sendCompletedFile(
      response,
      path.join(
        windowDirectory(rendition, index),
        filename ?? `segment_${String(index).padStart(6, "0")}.m4s`,
      ),
      contentType,
    );
  } catch (error) {
    if (controller.signal.aborted) return;
    deps.logEvent("warn", "video.window.failed", {
      sessionId: context.session.id,
      index,
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(503).json({ error: "Seek window could not be prepared. Try again." });
  } finally {
    response.removeListener("close", close);
  }
}

export function registerVideoHlsRoutes(app: Express, deps: VideoRouteDependencies): void {
  registerMasterRoute(app, deps);
  registerVariantRoute(app, deps);
  registerInitRoute(app, deps);
  registerSegmentRoute(app, deps);
  const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (error instanceof ApplicationError)
      response.status(error.status).json({ error: error.message });
    else next(error);
  };
  app.use("/api/sessions/:id/video/hls", handleError);
}
