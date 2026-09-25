import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { buildFmp4HlsArgs } from "./ffmpegHls.js";
import { codecsFromInit } from "./hlsManifest.js";

describe("FFmpeg adaptive HLS arguments", () => {
  it("creates aligned four-second fMP4 media", () => {
    const args = buildFmp4HlsArgs({
      inputPath: "input.mp4",
      outputDirectory: "rendition",
      height: 720,
    });

    expect(args).toContain("-force_key_frames");
    expect(args).toContain("expr:gte(t,n_forced*4)");
    expect(args).toContain("-hls_segment_type");
    expect(args).toContain("fmp4");
    expect(args[args.indexOf("-hls_flags") + 1]).toBe("temp_file");
    expect(args).toContain("rendition/segment_%06d.m4s");
    expect(args.at(-1)).toBe("rendition/index.m3u8");
  });

  it.each([false, true])(
    "reads real init codecs (audio: %s)",
    async (audio) => {
      if (!ffmpegPath) throw new Error("ffmpeg-static is unavailable.");
      const workspace = await mkdtemp(path.join(tmpdir(), "ziv-codecs-"));
      const source = path.join(workspace, "source.mp4");
      const output = path.join(workspace, "hls");
      await mkdir(output);
      try {
        execFileSync(ffmpegPath, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=160x90:rate=24",
          ...(audio ? ["-f", "lavfi", "-i", "sine=frequency=440"] : []),
          "-t",
          "1",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          ...(audio ? ["-c:a", "aac"] : []),
          source,
        ]);
        execFileSync(
          ffmpegPath,
          buildFmp4HlsArgs({
            inputPath: source,
            outputDirectory: output,
            height: 0,
          }),
        );
        const codecs = codecsFromInit(
          await readFile(path.join(output, "init.mp4")),
        );
        expect(codecs).toMatch(/^avc1\.4d40[0-9a-f]{2}/);
        expect(codecs?.includes("mp4a.40.2")).toBe(audio);
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it("omits scaling for a source-sized rendition", () => {
    const args = buildFmp4HlsArgs({
      inputPath: "input.mp4",
      outputDirectory: "source",
      height: 0,
    });

    expect(args).not.toContain("-vf");
  });

  it.each([
    [360, "800k"],
    [480, "1400k"],
    [720, "2800k"],
    [1080, "5000k"],
    [1440, "8000k"],
    [2160, "14000k"],
  ] as const)("selects the bounded bitrate for %ip", (height, bitrate) => {
    const args = buildFmp4HlsArgs({
      inputPath: "input.mp4",
      outputDirectory: "output\\",
      height,
      segmentDurationSeconds: 0,
    });
    expect(args[args.indexOf("-b:v") + 1]).toBe(bitrate);
    expect(args[args.indexOf("-hls_time") + 1]).toBe("1");
    expect(args.at(-1)).toBe("output/index.m3u8");
  });
});
