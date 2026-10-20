import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, it } from "vite-plus/test";
import { runCommand } from "../process/commandRunner.js";
import { videoDuration } from "./videoDuration.js";

it("finds the final video frame when audio continues beyond the initial tail probe", async () => {
  if (!ffmpegPath) throw new Error("FFmpeg is required.");
  const directory = await mkdtemp(path.join(tmpdir(), "video-duration-"));
  try {
    const input = path.join(directory, "long-audio.mkv");
    await runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=size=32x32:rate=1:duration=121",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=130",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      input,
    ]);
    expect(await videoDuration(ffmpegPath, input, 130.023)).toBeCloseTo(121, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
