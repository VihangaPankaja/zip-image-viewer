import { stat, type Stats } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import {
  ApplicationError,
  type Session,
  type VideoQualityOption,
} from "../../domain/models.js";
import { errorMessage, isWithinRoot, queryText } from "../httpUtils.js";
import type { VideoRouteDependencies } from "./types.js";

export type VideoContext = {
  session: Session;
  normalizedPath: string;
  targetPath: string;
  fileStats: Stats;
};

export { queryText } from "../httpUtils.js";

export function selectVideoQuality(
  options: VideoQualityOption[],
  requested: string,
): { quality: string; height: number } {
  const selected = options.find(({ id }) => id === requested);
  return selected && selected.id !== "source"
    ? { quality: selected.id, height: selected.height ?? 0 }
    : { quality: "source", height: 0 };
}

export function requireTranscoder(
  res: Response,
  deps: VideoRouteDependencies,
): string | null {
  if (deps.ffmpegPath) return deps.ffmpegPath;
  res.status(503).json({ error: "Video transcoder is unavailable." });
  return null;
}

export async function resolveVideoFile(
  sessionId: string,
  requestedPath: string,
  deps: Pick<VideoRouteDependencies, "touchSession" | "sanitizeEntryPath">,
): Promise<VideoContext> {
  const session = deps.touchSession(sessionId);
  if (!session) {
    throw new ApplicationError(
      "NOT_FOUND",
      "Session not found or already cleaned up.",
      404,
    );
  }
  if (!requestedPath || requestedPath === ".") {
    throw new ApplicationError("INVALID_INPUT", "File path is required.", 400);
  }
  let normalizedPath: string;
  try {
    normalizedPath = deps.sanitizeEntryPath(requestedPath);
  } catch (error) {
    throw new ApplicationError(
      "INVALID_INPUT",
      errorMessage(error, "Unexpected video error."),
      400,
    );
  }
  const targetPath = path.resolve(session.extractDir, normalizedPath);
  if (session.availablePaths && !session.availablePaths.has(normalizedPath)) {
    throw new ApplicationError("NOT_FOUND", "File is not available yet.", 404);
  }
  const rootPath = path.resolve(session.extractDir);
  if (!isWithinRoot(targetPath, rootPath)) {
    throw new ApplicationError("INVALID_INPUT", "Invalid file path.", 400);
  }
  const fileStats = await new Promise<Stats | null>((resolve) => {
    stat(targetPath, (error, stats) => resolve(error ? null : stats));
  });
  if (!fileStats?.isFile()) {
    throw new ApplicationError("NOT_FOUND", "File not found.", 404);
  }
  return { session, normalizedPath, targetPath, fileStats };
}

export async function resolveVideoContext(
  req: Request,
  res: Response,
  deps: VideoRouteDependencies,
): Promise<VideoContext | null> {
  try {
    return await resolveVideoFile(
      queryText(req.params.id),
      queryText(req.query.path),
      deps,
    );
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
    res.status(error.status).json({ error: error.message });
    return null;
  }
}
