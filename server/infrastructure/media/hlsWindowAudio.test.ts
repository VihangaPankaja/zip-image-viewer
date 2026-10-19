import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, it } from "vite-plus/test";
import type { Session } from "../../domain/models.js";
import { createVideoRuntime } from "./videoRuntime.js";
import { windowDirectory } from "./hlsWindows.js";
import { runCommand, runCommandCapture } from "../process/commandRunner.js";

it.each([false, true])(
  "seeks beyond a short audio track without losing video or failing audio (audio: %s)",
  async (audio) => {
    if (!ffmpegPath) throw new Error("FFmpeg is required.");
    const workspaceDir = await mkdtemp(
      path.join(tmpdir(), "window-audio-tail-"),
    );
    const session = { id: "audio-tail", workspaceDir } as Session;
    const runtime = createVideoRuntime({
      ffmpegPath,
      transcodes: new Map(),
      logEvent: () => undefined,
    });
    try {
      const source = path.join(workspaceDir, "source.mkv");
      await runCommand(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=size=32x32:rate=1:duration=130",
        ...(audio
          ? [
              "-f",
              "lavfi",
              "-i",
              "sine=duration=2",
              "-f",
              "lavfi",
              "-i",
              "sine=duration=130",
              "-map",
              "0:v",
              "-map",
              "1:a",
              "-map",
              "2:a",
              "-c:a",
              "aac",
            ]
          : []),
        "-c:v",
        "libx264",
        source,
      ]);
      const entry = await runtime.ensureVideoTranscodeEntry(
        session,
        "source.mkv",
        source,
      );
      const rendition = runtime.getRenditionState(
        entry,
        session,
        audio ? "audio-1" : "source",
      );
      await runtime.startPrioritySegmentWindow(entry, session, rendition, 32);
      const playlist = path.join(windowDirectory(rendition, 32), "index.m3u8");
      const decoded = await runCommandCapture(ffmpegPath, [
        "-hide_banner",
        "-i",
        playlist,
        ...(audio
          ? ["-map", "0:a:0", "-ac", "1", "-t", "1", "-f", "s16le"]
          : ["-f", "null"]),
        "-",
      ]);
      if (audio) {
        expect(decoded.stdout).toHaveLength(96000);
        expect(decoded.stdout.replace(/\0/g, "")).toBe("");
      } else expect(decoded.stderr).toMatch(/frame=\s*60/);
    } finally {
      await runtime.cleanupVideoSession(session);
      await rm(workspaceDir, { recursive: true, force: true });
    }
  },
  45_000,
);
