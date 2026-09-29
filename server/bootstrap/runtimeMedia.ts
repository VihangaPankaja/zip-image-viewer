import type { RequestHandler } from "express";
import type { Session, VideoTranscodeEntry } from "../domain/models.js";
import { MEDIA_CACHE_BUDGET_BYTES } from "../config/runtimeConstants.js";
import {
  ensureRuntimeImagePreview,
  ensureRuntimeThumbnail,
} from "../runtimeAdapters.js";
import { createDerivedMediaCache } from "../infrastructure/media/derivedMediaCache.js";
import { createVideoRuntime } from "../infrastructure/media/videoRuntime.js";

type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;

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
  const pinMediaRequest: RequestHandler = (req, res, next) => {
    const release = cache.protectSession(req.params.id as string);
    res.once("finish", release);
    res.once("close", release);
    next();
  };
  const ensureThumbnail: typeof ensureRuntimeThumbnail = async (
    session,
    normalizedPath,
    targetPath,
    size,
  ) => {
    if (sessions.get(session.id) !== session)
      throw new Error("Session has been removed.");
    const result = await videoRuntime.trackVideoTask(
      session,
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
    const result = await videoRuntime.trackVideoTask(
      session,
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
    videoRuntime,
    enforceMediaBudget,
    pinMediaRequest,
    ensureThumbnail,
    ensureImagePreview,
  };
}
