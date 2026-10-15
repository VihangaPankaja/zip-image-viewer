import type { Express } from "express";
import { runCommandCapture } from "../../infrastructure/process/commandRunner.js";
import {
  queryText,
  requireTranscoder,
  resolveVideoContext,
} from "./routeContext.js";
import type { VideoRouteDependencies } from "./types.js";

const MAX_SUBTITLE_BYTES = 2 * 1024 ** 2;

export function registerVideoSubtitleRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/subtitles", async (req, res) => {
    const context = await resolveVideoContext(req, res, deps);
    const executable = context && requireTranscoder(res, deps);
    if (!context || !executable) return;
    const metadata = await deps.getVideoMetadata(
      context.targetPath,
      context.session,
    );
    const track = metadata.subtitleTracks?.find(
      ({ id }) => id === queryText(req.query.track),
    );
    if (!track) {
      res.status(400).json({ error: "Unknown text subtitle track." });
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once("close", abort);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30_000),
    ]);
    try {
      const { stdout } = await deps.runVideoTask(
        context.session,
        (taskSignal) =>
          runCommandCapture(
            executable,
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-i",
              context.targetPath,
              "-map",
              `0:${String(track.index)}`,
              "-c:s",
              "webvtt",
              "-f",
              "webvtt",
              "pipe:1",
            ],
            { signal: taskSignal },
          ),
        signal,
      );
      if (
        Buffer.byteLength(stdout) > MAX_SUBTITLE_BYTES ||
        !stdout.startsWith("WEBVTT")
      ) {
        res.status(422).json({
          error: "Subtitle track is invalid or exceeds the 2 MiB limit.",
        });
        return;
      }
      res.set("Cache-Control", "private, no-store");
      res.type("text/vtt").send(stdout);
    } catch {
      if (!res.destroyed)
        res.status(422).json({
          error:
            "Subtitle track could not be converted. Choose another track or add a subtitle file.",
        });
    } finally {
      res.removeListener("close", abort);
    }
  });
}
