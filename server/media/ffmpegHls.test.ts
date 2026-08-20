import { describe, expect, it } from "vitest";
import { buildFmp4HlsArgs } from "./ffmpegHls.js";

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
    expect(args).toContain("rendition/segment_%06d.m4s");
    expect(args.at(-1)).toBe("rendition/index.m3u8");
  });

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
