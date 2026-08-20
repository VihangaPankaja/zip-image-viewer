import { stat, type Stats } from "node:fs";
import path from "node:path";
import type { Request, Response } from "express";
import type { Session } from "../../domain/models.js";
import type { VideoRouteDependencies } from "./types.js";

export type VideoContext = {
  session: Session;
  normalizedPath: string;
  targetPath: string;
  fileStats: Stats;
};

export function queryText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected video error.";
}

export function requireTranscoder(
  res: Response,
  deps: VideoRouteDependencies,
): string | null {
  if (deps.ffmpegPath) return deps.ffmpegPath;
  res.status(503).json({ error: "Video transcoder is unavailable." });
  return null;
}

export function resolveVideoSession(
  req: Request,
  res: Response,
  deps: VideoRouteDependencies,
): Session | null {
  const session = deps.touchSession(queryText(req.params.id));
  if (session) return session;
  res.status(404).json({ error: "Session not found or already cleaned up." });
  return null;
}

export async function resolveVideoFileContext(
  req: Request,
  res: Response,
  deps: VideoRouteDependencies,
  session: Session,
): Promise<VideoContext | null> {
  const requestedPath = queryText(req.query.path);
  if (!requestedPath || requestedPath === ".") {
    res.status(400).json({ error: "File path is required." });
    return null;
  }
  let normalizedPath: string;
  try {
    normalizedPath = deps.sanitizeEntryPath(requestedPath);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
    return null;
  }
  const targetPath = path.resolve(session.extractDir, normalizedPath);
  const rootPath = path.resolve(session.extractDir);
  if (
    !targetPath.startsWith(`${rootPath}${path.sep}`) &&
    targetPath !== rootPath
  ) {
    res.status(400).json({ error: "Invalid file path." });
    return null;
  }
  const fileStats = await new Promise<Stats | null>((resolve) => {
    stat(targetPath, (error, stats) => resolve(error ? null : stats));
  });
  if (!fileStats?.isFile()) {
    res.status(404).json({ error: "File not found." });
    return null;
  }
  return { session, normalizedPath, targetPath, fileStats };
}

export async function resolveVideoContext(
  req: Request,
  res: Response,
  deps: VideoRouteDependencies,
): Promise<VideoContext | null> {
  const session = resolveVideoSession(req, res, deps);
  return session ? resolveVideoFileContext(req, res, deps, session) : null;
}
