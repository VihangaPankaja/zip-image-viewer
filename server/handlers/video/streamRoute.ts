import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { Express, Request, RequestHandler, Response } from "express";
import {
  queryText,
  requireTranscoder,
  resolveVideoFileContext,
  resolveVideoSession,
  type VideoContext,
} from "./routeContext.js";
import type { VideoRouteDependencies } from "./types.js";

function buildTranscodeArgs(
  targetPath: string,
  selectedHeight: number,
): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-i", targetPath];
  if (selectedHeight > 0) {
    args.push("-vf", `scale=-2:${String(selectedHeight)}`);
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    selectedHeight >= 1440 ? "27" : selectedHeight >= 1080 ? "26" : "24",
    "-c:a",
    "aac",
    "-movflags",
    "+frag_keyframe+empty_moov+faststart",
    "-f",
    "mp4",
    "pipe:1",
  );
  return args;
}

function pipeTranscode(
  req: Request,
  res: Response,
  deps: VideoRouteDependencies,
  context: VideoContext,
  quality: string,
  child: ChildProcessByStdio<null, Readable, Readable>,
): void {
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  req.on("close", () => {
    if (!child.killed) child.kill("SIGTERM");
  });
  child.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to start transcoder." });
    }
  });
  child.on("close", (code) => {
    if (code !== 0 && !res.writableEnded) {
      res.end();
      deps.logEvent("warn", "session.video.transcode.failed", {
        sessionId: context.session.id,
        path: context.normalizedPath,
        quality,
        code,
        stderr: stderr.slice(-500),
      });
    }
  });
  child.stdout.pipe(res);
}

function createStreamHandler(deps: VideoRouteDependencies): RequestHandler {
  return async (req, res) => {
    const session = resolveVideoSession(req, res, deps);
    if (!session) return;
    const ffmpegPath = requireTranscoder(res, deps);
    if (!ffmpegPath) return;
    const context = await resolveVideoFileContext(req, res, deps, session);
    if (!context) return;
    const quality = queryText(req.query.quality, "source").toLowerCase();
    const sourceDimensions = await deps.getVideoDimensions(context.targetPath);
    const { options } = deps.buildVideoQualityOptions(sourceDimensions.height);
    const selectedQuality =
      options.find(({ id }) => id === quality)?.id || "source";
    const selectedHeight =
      selectedQuality === "source"
        ? 0
        : Number.parseInt(selectedQuality.replace("p", ""), 10) || 0;
    res.setHeader("cache-control", "no-store");
    res.type("video/mp4");
    const child = spawn(
      ffmpegPath,
      buildTranscodeArgs(context.targetPath, selectedHeight),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    pipeTranscode(req, res, deps, context, selectedQuality, child);
  };
}

export function registerVideoStreamRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/stream", createStreamHandler(deps));
}
