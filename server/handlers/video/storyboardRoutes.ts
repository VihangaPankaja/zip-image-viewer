import path from "node:path";
import type { Express } from "express";
import { storyboardDirectory } from "../../media/videoStoryboard.js";
import {
  queryText,
  requireTranscoder,
  resolveVideoContext,
} from "./routeContext.js";
import type { VideoRouteDependencies } from "./types.js";

export function registerVideoStoryboardRoutes(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/storyboard", async (req, res) => {
    const context = await resolveVideoContext(req, res, deps);
    if (!context || !requireTranscoder(res, deps)) return;
    const index = await deps.ensureVideoStoryboard(
      context.session,
      context.normalizedPath,
      context.targetPath,
    );
    res.setHeader("cache-control", "private, max-age=31536000, immutable");
    res.json(index);
  });
  app.get("/api/sessions/:id/video/storyboard/sheet", async (req, res) => {
    const context = await resolveVideoContext(req, res, deps);
    if (!context || !requireTranscoder(res, deps)) return;
    const sheet = Number(queryText(req.query.sheet, "-1"));
    if (!Number.isInteger(sheet) || sheet < 0 || sheet >= 10) {
      res.status(400).json({ error: "Invalid storyboard sheet." });
      return;
    }
    const index = await deps.ensureVideoStoryboard(
      context.session,
      context.normalizedPath,
      context.targetPath,
    );
    if (sheet > (index.frames.at(-1)?.sheet ?? -1)) {
      res.status(404).json({ error: "Storyboard sheet not found." });
      return;
    }
    res.setHeader("cache-control", "private, max-age=31536000, immutable");
    res
      .type("image/jpeg")
      .sendFile(
        path.join(
          storyboardDirectory(
            context.session.workspaceDir,
            context.normalizedPath,
          ),
          `sheet-${String(sheet + 1)}.jpg`,
        ),
      );
  });
}
