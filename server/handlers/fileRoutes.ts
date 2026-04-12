// @ts-nocheck
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";

export function registerFileRoutes(app, deps) {
  app.get("/api/sessions/:id/file", async (req, res) => {
    const session = deps.touchSession(req.params.id);
    if (!session) {
      deps.logEvent("warn", "session.file.missing", {
        sessionId: req.params.id,
      });
      return res
        .status(404)
        .json({ error: "Session not found or already cleaned up." });
    }

    const requestedPath = String(req.query.path || "");
    if (!requestedPath || requestedPath === ".") {
      deps.logEvent("warn", "session.file.rejected", {
        sessionId: session.id,
        reason: "missing_path",
      });
      return res.status(400).json({ error: "File path is required." });
    }

    let normalizedPath;
    try {
      normalizedPath = deps.sanitizeEntryPath(requestedPath);
    } catch (error) {
      deps.logEvent("warn", "session.file.rejected", {
        sessionId: session.id,
        requestedPath,
        reason: error.message,
      });
      return res.status(400).json({ error: error.message });
    }

    const targetPath = path.resolve(
      path.join(session.extractDir, normalizedPath),
    );
    const rootPath = path.resolve(session.extractDir);

    if (
      !targetPath.startsWith(`${rootPath}${path.sep}`) &&
      targetPath !== rootPath
    ) {
      deps.logEvent("warn", "session.file.rejected", {
        sessionId: session.id,
        requestedPath,
        reason: "invalid_path",
      });
      return res.status(400).json({ error: "Invalid file path." });
    }

    const fileStats = await stat(targetPath).catch(() => null);
    if (!fileStats || !fileStats.isFile()) {
      deps.logEvent("warn", "session.file.missing", {
        sessionId: session.id,
        requestedPath: normalizedPath,
      });
      return res.status(404).json({ error: "File not found." });
    }

    const wantsPreview = req.query.preview === "1";
    const wantsThumbnail = req.query.thumbnail === "1";
    const wantsImagePreview = req.query.imagePreview === "1";
    const previewQuality = String(req.query.quality || "balanced");
    const contentType = mime.lookup(targetPath) || "application/octet-stream";
    const rangeHeader = req.headers.range;
    deps.logEvent("info", "session.file.read", {
      sessionId: session.id,
      path: normalizedPath,
      preview: wantsPreview,
      thumbnail: wantsThumbnail,
      imagePreview: wantsImagePreview,
      previewQuality,
      size: fileStats.size,
      sizeLabel: deps.formatBytes(fileStats.size),
      contentType,
    });
    res.setHeader("cache-control", "no-store");

    if (wantsPreview) {
      res.type(contentType);
      const previewBuffer = await deps.readPreviewChunk(targetPath);
      return res.send(previewBuffer);
    }

    if (wantsThumbnail) {
      if (deps.classifyMimeType(contentType) !== "image") {
        return res.status(400).json({
          error: "Thumbnail preview is only available for image files.",
        });
      }

      try {
        const thumbnailPath = await deps.ensureThumbnail(
          session,
          normalizedPath,
          targetPath,
          req.query.size,
        );
        res.type("image/jpeg");
        return createReadStream(thumbnailPath).pipe(res);
      } catch (error) {
        deps.logEvent("warn", "session.thumbnail.failed", {
          sessionId: session.id,
          path: normalizedPath,
          error: error.message,
        });
        res.type(contentType);
        return createReadStream(targetPath).pipe(res);
      }
    }

    if (wantsImagePreview) {
      if (deps.classifyMimeType(contentType) !== "image") {
        return res
          .status(400)
          .json({ error: "Image preview is only available for image files." });
      }

      if (deps.shouldPreserveOriginalPreview(contentType)) {
        res.type(contentType);
        return createReadStream(targetPath).pipe(res);
      }

      try {
        const previewPath = await deps.ensureImagePreview(
          session,
          normalizedPath,
          targetPath,
          previewQuality,
        );
        res.type("image/jpeg");
        return createReadStream(previewPath).pipe(res);
      } catch (error) {
        deps.logEvent("warn", "session.image_preview.failed", {
          sessionId: session.id,
          path: normalizedPath,
          quality: previewQuality,
          error: error.message,
        });
        res.type(contentType);
        return createReadStream(targetPath).pipe(res);
      }
    }

    res.setHeader("accept-ranges", "bytes");
    res.type(contentType);

    const range = deps.parseRangeHeader(rangeHeader, fileStats.size);
    if (range === "invalid") {
      res.setHeader("content-range", `bytes */${fileStats.size}`);
      return res.status(416).end();
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      res.status(206);
      res.setHeader(
        "content-range",
        `bytes ${range.start}-${range.end}/${fileStats.size}`,
      );
      res.setHeader("content-length", String(contentLength));
      return createReadStream(targetPath, {
        start: range.start,
        end: range.end,
      }).pipe(res);
    }

    res.setHeader("content-length", String(fileStats.size));

    return createReadStream(targetPath).pipe(res);
  });
}
