import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { buildFmp4HlsArgs } from "../../server/media/ffmpegHls.js";

function runFfmpeg(args: string[]): Promise<void> {
  const executable = ffmpegPath;
  if (!executable) throw new Error("ffmpeg-static is unavailable.");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `FFmpeg exited with ${String(code)}.`));
    });
  });
}

describe("real FFmpeg HLS fixture", () => {
  it("produces a playable fMP4 initialization file and media segment", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "ziv-hls-"));
    const sourcePath = path.join(workspace, "source.mp4");
    const renditionDirectory = path.join(workspace, "360p");
    await mkdir(renditionDirectory);

    try {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=640x360:rate=24",
        "-t",
        "1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        sourcePath,
      ]);
      await runFfmpeg(
        buildFmp4HlsArgs({
          inputPath: sourcePath,
          outputDirectory: renditionDirectory,
          height: 360,
        }),
      );

      const outputs = await readdir(renditionDirectory);
      expect(outputs).toContain("init.mp4");
      expect(outputs).toContain("index.m3u8");
      expect(outputs.some((file) => file.endsWith(".m4s"))).toBe(true);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 30_000);
});
