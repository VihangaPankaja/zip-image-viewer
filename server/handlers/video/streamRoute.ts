import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { Express, Request, Response } from "express";
import {
  queryText,
  requireTranscoder,
  resolveVideoContext,
  selectVideoQuality,
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

export function registerVideoStreamRoute(
  app: Express,
  deps: VideoRouteDependencies,
): void {
  app.get("/api/sessions/:id/video/stream", async (req, res) => {
    const context = await resolveVideoContext(req, res, deps);
    const ffmpegPath = context && requireTranscoder(res, deps);
    if (!context || !ffmpegPath) return;
    const quality = queryText(req.query.quality, "source").toLowerCase();
    const sourceDimensions = await deps.getVideoDimensions(context.targetPath);
    const { options } = deps.buildVideoQualityOptions(sourceDimensions.height);
    const selected = selectVideoQuality(options, quality);
    res.setHeader("cache-control", "no-store");
    res.type("video/mp4");
    const child = spawn(
      ffmpegPath,
      buildTranscodeArgs(context.targetPath, selected.height),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    pipeTranscode(req, res, deps, context, selected.quality, child);
  });
}
