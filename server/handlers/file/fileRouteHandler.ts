import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import type { Request, RequestHandler, Response } from "express";
import type { Session } from "../../domain/models.js";
import {
  applyByteRange,
  errorMessage,
  isWithinRoot,
  queryText,
} from "../httpUtils.js";

type ByteRange = { start: number; end: number };
type FileContext = {
  session: Session;
  normalizedPath: string;
  targetPath: string;
  contentType: string;
  size: number;
};

export type FileRouteDependencies = {
  touchSession: (_sessionId: string) => Session | undefined;
  logEvent: (
    _level: "info" | "warn" | "error",
    _event: string,
    _details?: Record<string, unknown>,
  ) => void;
  sanitizeEntryPath: (_path: string) => string;
  formatBytes: (_bytes: number) => string;
  readPreviewChunk: (_targetPath: string) => Promise<Buffer>;
  classifyMimeType: (_contentType: string) => "image" | "text" | "binary";
  ensureThumbnail: (
    _session: Session,
    _normalizedPath: string,
    _targetPath: string,
    _size: unknown,
  ) => Promise<string>;
  shouldPreserveOriginalPreview: (_contentType: string) => boolean;
  ensureImagePreview: (
    _session: Session,
    _normalizedPath: string,
    _targetPath: string,
    _quality: string,
  ) => Promise<string>;
  parseRangeHeader: (
    _header: string | undefined,
    _size: number,
  ) => ByteRange | "invalid" | null;
};

async function resolveFileContext(
  req: Request,
  res: Response,
  deps: FileRouteDependencies,
): Promise<FileContext | null> {
  const sessionId = queryText(req.params.id);
  const session = deps.touchSession(sessionId);
  if (!session) {
    deps.logEvent("warn", "session.file.missing", { sessionId });
    res.status(404).json({ error: "Session not found or already cleaned up." });
    return null;
  }
  const requestedPath = queryText(req.query.path);
  if (!requestedPath || requestedPath === ".") {
    deps.logEvent("warn", "session.file.rejected", {
      sessionId: session.id,
      reason: "missing_path",
    });
    res.status(400).json({ error: "File path is required." });
    return null;
  }
  let normalizedPath: string;
  try {
    normalizedPath = deps.sanitizeEntryPath(requestedPath);
  } catch (error) {
    deps.logEvent("warn", "session.file.rejected", {
      sessionId: session.id,
      requestedPath,
      reason: errorMessage(error, "Unexpected file error."),
    });
    res.status(400).json({
      error: errorMessage(error, "Unexpected file error."),
    });
    return null;
  }
  const targetPath = path.resolve(session.extractDir, normalizedPath);
  const rootPath = path.resolve(session.extractDir);
  if (!isWithinRoot(targetPath, rootPath)) {
    deps.logEvent("warn", "session.file.rejected", {
      sessionId: session.id,
      requestedPath,
      reason: "invalid_path",
    });
    res.status(400).json({ error: "Invalid file path." });
    return null;
  }
  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats?.isFile()) {
    deps.logEvent("warn", "session.file.missing", {
      sessionId: session.id,
      requestedPath: normalizedPath,
    });
    res.status(404).json({ error: "File not found." });
    return null;
  }
  return {
    session,
    normalizedPath,
    targetPath,
    contentType: mime.lookup(targetPath) || "application/octet-stream",
    size: fileStats.size,
  };
}

async function serveThumbnail(
  req: Request,
  res: Response,
  deps: FileRouteDependencies,
  context: FileContext,
): Promise<void> {
  if (deps.classifyMimeType(context.contentType) !== "image") {
    res.status(400).json({
      error: "Thumbnail preview is only available for image files.",
    });
    return;
  }
  try {
    const thumbnailPath = await deps.ensureThumbnail(
      context.session,
      context.normalizedPath,
      context.targetPath,
      req.query.size,
    );
    res.type("image/jpeg");
    createReadStream(thumbnailPath).pipe(res);
  } catch (error) {
    deps.logEvent("warn", "session.thumbnail.failed", {
      sessionId: context.session.id,
      path: context.normalizedPath,
      error: errorMessage(error, "Unexpected file error."),
    });
    res.type(context.contentType);
    createReadStream(context.targetPath).pipe(res);
  }
}

async function serveImagePreview(
  quality: string,
  res: Response,
  deps: FileRouteDependencies,
  context: FileContext,
): Promise<void> {
  if (deps.classifyMimeType(context.contentType) !== "image") {
    res.status(400).json({
      error: "Image preview is only available for image files.",
    });
    return;
  }
  if (deps.shouldPreserveOriginalPreview(context.contentType)) {
    res.type(context.contentType);
    createReadStream(context.targetPath).pipe(res);
    return;
  }
  try {
    const previewPath = await deps.ensureImagePreview(
      context.session,
      context.normalizedPath,
      context.targetPath,
      quality,
    );
    res.type("image/jpeg");
    createReadStream(previewPath).pipe(res);
  } catch (error) {
    deps.logEvent("warn", "session.image_preview.failed", {
      sessionId: context.session.id,
      path: context.normalizedPath,
      quality,
      error: errorMessage(error, "Unexpected file error."),
    });
    res.type(context.contentType);
    createReadStream(context.targetPath).pipe(res);
  }
}

function serveFile(
  req: Request,
  res: Response,
  deps: FileRouteDependencies,
  context: FileContext,
): void {
  res.type(context.contentType);
  const range = applyByteRange(
    res,
    deps.parseRangeHeader(req.headers.range, context.size),
    context.size,
  );
  if (range === null) return;
  createReadStream(context.targetPath, range).pipe(res);
}

export function createFileRouteHandler(
  deps: FileRouteDependencies,
): RequestHandler {
  return async (req, res) => {
    const context = await resolveFileContext(req, res, deps);
    if (!context) return;
    const wantsPreview = req.query.preview === "1";
    const wantsThumbnail = req.query.thumbnail === "1";
    const wantsImagePreview = req.query.imagePreview === "1";
    const previewQuality = queryText(req.query.quality, "balanced");
    deps.logEvent("info", "session.file.read", {
      sessionId: context.session.id,
      path: context.normalizedPath,
      preview: wantsPreview,
      thumbnail: wantsThumbnail,
      imagePreview: wantsImagePreview,
      previewQuality,
      size: context.size,
      sizeLabel: deps.formatBytes(context.size),
      contentType: context.contentType,
    });
    res.setHeader("cache-control", "no-store");
    if (wantsPreview) {
      res.type(context.contentType);
      res.send(await deps.readPreviewChunk(context.targetPath));
    } else if (wantsThumbnail) {
      await serveThumbnail(req, res, deps, context);
    } else if (wantsImagePreview) {
      await serveImagePreview(previewQuality, res, deps, context);
    } else {
      serveFile(req, res, deps, context);
    }
  };
}
