import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, it } from "vite-plus/test";
import type { Session } from "../../domain/models.js";
import { runCommand, runCommandCapture } from "../process/commandRunner.js";
import { createVideoRuntime } from "./videoRuntime.js";
import { windowDirectory } from "./hlsWindows.js";

it.each([0, 1, 2])(
  "keeps window video presentation and decode timestamps aligned with %s audio tracks",
  async (audioTracks) => {
    if (!ffmpegPath) throw new Error("FFmpeg is required.");
    const directory = await mkdtemp(path.join(tmpdir(), "window-alignment-"));
    const session = { id: "aligned", workspaceDir: directory } as Session;
    const runtime = createVideoRuntime({
      ffmpegPath,
      transcodes: new Map(),
      logEvent: () => undefined,
    });
    try {
      const source = path.join(directory, "source.mkv");
      await runCommand(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=size=32x32:rate=30:duration=130",
        ...(audioTracks ? ["-f", "lavfi", "-i", "sine=duration=130"] : []),
        "-map",
        "0:v",
        ...Array.from({ length: audioTracks }, () => ["-map", "1:a"]).flat(),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-g",
        "60",
        "-c:a",
        "aac",
        source,
      ]);
      const entry = await runtime.ensureVideoTranscodeEntry(
        session,
        "source.mkv",
        source,
      );
      const rendition = runtime.getRenditionState(entry, session, "source");
      for (const index of [0, 2, 4]) {
        await runtime.startPrioritySegmentWindow(
          entry,
          session,
          rendition,
          index,
        );
        const { stderr } = await runCommandCapture(ffmpegPath, [
          "-hide_banner",
          "-copyts",
          "-debug_ts",
          "-i",
          path.join(windowDirectory(rendition, index), "index.m3u8"),
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-f",
          "null",
          "-",
        ]);
        const packet =
          /demuxer -> .*?type:video.*?pkt_pts_time:([-\d.]+).*?pkt_dts_time:([-\d.]+)/.exec(
            stderr,
          );
        expect(packet).not.toBeNull();
        // HLS.js uses decode time to initialize each discontinuity. A composition
        // offset would then accumulate in the advertised presentation timeline.
        expect(Number(packet?.[1])).toBeCloseTo(Number(packet?.[2]), 5);
      }
    } finally {
      await runtime.cleanupVideoSession(session);
      await rm(directory, { recursive: true, force: true });
    }
  },
  45_000,
);
