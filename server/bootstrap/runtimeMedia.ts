import type { RequestHandler } from "express";
import type { Session, VideoTranscodeEntry } from "../domain/models.js";
import { MEDIA_CACHE_BUDGET_BYTES } from "../config/runtimeConstants.js";
import {
  ensureRuntimeImagePreview,
  ensureRuntimeThumbnail,
} from "../runtimeAdapters.js";
import { createDerivedMediaCache } from "../infrastructure/media/derivedMediaCache.js";
import { createVideoRuntime } from "../infrastructure/media/videoRuntime.js";
import { prepareRetainedSession } from "../infrastructure/media/prepareRetainedSession.js";

type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;

function pinMediaRequests(
  cache: ReturnType<typeof createDerivedMediaCache>,
): RequestHandler {
  return async (req, res, next) => {
    const release = cache.protectSession(req.params.id as string);
    res.once("finish", release);
    res.once("close", release);
    try {
      await cache.waitForEviction(req.params.id as string);
      if (!res.destroyed) next();
    } catch (error) {
      next(error);
    }
  };
}

export function createRuntimeMedia(
  ffmpegPath: string | null,
  sessions: Map<string, Session>,
  transcodes: Map<string, VideoTranscodeEntry>,
  logEvent: LogEvent,
) {
  const cache = createDerivedMediaCache(
    sessions,
    transcodes,
    MEDIA_CACHE_BUDGET_BYTES,
  );
  const enforceMediaBudget = async () => {
    await cache.enforce().catch((error: unknown) => {
      logEvent("warn", "media.cache.cleanup.failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  setInterval(() => void enforceMediaBudget(), 10_000).unref();

  const videoRuntime = createVideoRuntime({
    ffmpegPath,
    transcodes,
    logEvent,
    protectSession: cache.protectSession,
    enforceDerivedMediaBudget: enforceMediaBudget,
  });
  const ensureThumbnail: typeof ensureRuntimeThumbnail = async (
    session,
    normalizedPath,
    targetPath,
    size,
  ) => {
    if (sessions.get(session.id) !== session)
      throw new Error("Session has been removed.");
    const result = await videoRuntime.runVideoTask(session, () =>
      ensureRuntimeThumbnail(session, normalizedPath, targetPath, size),
    );
    await enforceMediaBudget();
    return result;
  };
  const ensureImagePreview: typeof ensureRuntimeImagePreview = async (
    session,
    normalizedPath,
    targetPath,
    profileName,
  ) => {
    if (sessions.get(session.id) !== session)
      throw new Error("Session has been removed.");
    const result = await videoRuntime.runVideoTask(session, () =>
      ensureRuntimeImagePreview(
        session,
        normalizedPath,
        targetPath,
        profileName,
      ),
    );
    await enforceMediaBudget();
    return result;
  };
  return {
    prepareRetainedSession: retainedPreparation(
      videoRuntime,
      sessions,
      ffmpegPath,
      logEvent,
    ),
    storage: cache.storage,
    clearMediaCache: (session: Session) =>
      cache.clear(session, () => videoRuntime.clearCachedMedia(session)),
    videoRuntime,
    enforceMediaBudget,
    pinMediaRequest: pinMediaRequests(cache),
    ensureThumbnail,
    ensureImagePreview,
  };
}

function retainedPreparation(
  videoRuntime: ReturnType<typeof createVideoRuntime>,
  sessions: ReadonlyMap<string, Session>,
  ffmpegPath: string | null,
  logEvent: LogEvent,
) {
  return (session: Session) => {
    if (!ffmpegPath || !session.retained) return;
    const report = (error: unknown) =>
      logEvent("warn", "video.prepare.failed", {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    void videoRuntime
      .trackVideoTask(
        session,
        prepareRetainedSession(
          session,
          sessions,
          (item, file, target) =>
            videoRuntime.ensureVideoTranscodeEntry(
              item,
              file,
              target,
              "background",
            ),
          report,
        ),
      )
      .catch(report);
  };
}
