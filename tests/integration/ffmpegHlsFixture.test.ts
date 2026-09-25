import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { buildFmp4HlsArgs } from "../../server/media/ffmpegHls.js";
import {
  buildMasterPlaylist,
  calculateRenditions,
  codecsFromInit,
  publishedSegments,
} from "../../server/media/hlsManifest.js";

function runFfmpeg(args: string[]): Promise<string> {
  const executable = ffmpegPath;
  if (!executable) throw new Error("ffmpeg-static is unavailable.");
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `FFmpeg exited with ${String(code)}.`));
    });
  });
}

describe("real FFmpeg HLS fixture", () => {
  it.each([
    {
      name: "long GOP with audio",
      input: [
        "testsrc2=size=640x360:rate=24:duration=5",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=5",
        "-c:v",
        "libx264",
        "-g",
        "240",
        "-c:a",
        "aac",
        "-shortest",
      ],
      audio: true,
    },
    {
      name: "variable frame rate without audio",
      input: [
        "testsrc2=size=640x360:rate=30:duration=5",
        "-vf",
        "select=not(mod(n\\,3))",
        "-fps_mode",
        "vfr",
        "-c:v",
        "libx264",
      ],
      audio: false,
    },
    {
      name: "MPEG-4 source transcoded to browser codec",
      input: [
        "testsrc2=size=640x360:rate=24:duration=5",
        "-c:v",
        "mpeg4",
        "-q:v",
        "4",
      ],
      audio: false,
      unsupportedSource: true,
    },
  ])(
    "publishes decodable HLS from $name",
    async ({ input, audio, unsupportedSource }) => {
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
          input[0],
          ...input.slice(1),
          "-pix_fmt",
          "yuv420p",
          sourcePath,
        ]);
        await runFfmpeg(
          buildFmp4HlsArgs({
            inputPath: sourcePath,
            outputDirectory: renditionDirectory,
            height: 360,
            segmentDurationSeconds: 2,
          }),
        );

        const outputs = await readdir(renditionDirectory);
        expect(outputs).toContain("init.mp4");
        expect(outputs).toContain("index.m3u8");
        expect(outputs.some((file) => file.endsWith(".m4s"))).toBe(true);
        expect(outputs.some((file) => file.endsWith(".tmp"))).toBe(false);
        const playlist = await readFile(
          path.join(renditionDirectory, "index.m3u8"),
          "utf8",
        );
        const segments = publishedSegments(playlist);
        expect(segments.length).toBeGreaterThan(1);
        expect(segments).toEqual(segments.map((_, index) => index));
        expect(playlist.match(/^#EXTINF:/gm)).toHaveLength(segments.length);
        expect(playlist).toContain("#EXT-X-ENDLIST");
        const codecs = codecsFromInit(
          await readFile(path.join(renditionDirectory, "init.mp4")),
        );
        expect(codecs).toMatch(/^avc1\.[0-9a-f]{6}/);
        expect(codecs?.includes("mp4a.40.2")).toBe(audio);
        const master = buildMasterPlaylist(
          calculateRenditions({ width: 640, height: 360 }).map((rendition) => ({
            ...rendition,
            codecs,
          })),
          () => "index.m3u8",
        );
        expect(master).toContain(`CODECS="${codecs}"`);
        expect(master).not.toContain("mp4v");
        if (unsupportedSource) {
          expect((await readFile(sourcePath)).includes("mp4v")).toBe(true);
          expect(codecs).not.toContain("mp4v");
        }
        const durations = [...playlist.matchAll(/^#EXTINF:([\d.]+),/gm)].map(
          (match) => Number(match[1]),
        );
        const sizes = await Promise.all(
          segments.map(
            async (index) =>
              (
                await stat(
                  path.join(
                    renditionDirectory,
                    `segment_${String(index).padStart(6, "0")}.m4s`,
                  ),
                )
              ).size,
          ),
        );
        const peakSegmentBitrate = Math.max(
          ...sizes.map((size, index) => (size * 8) / durations[index]),
        );
        expect(peakSegmentBitrate).toBeLessThanOrEqual(
          calculateRenditions({ width: 640, height: 360 })[0].bandwidth,
        );
        await runFfmpeg([
          "-hide_banner",
          "-loglevel",
          "error",
          "-xerror",
          "-err_detect",
          "explode",
          "-i",
          path.join(renditionDirectory, "index.m3u8"),
          "-f",
          "null",
          "-",
        ]);
        const frame = await runFfmpeg([
          "-hide_banner",
          "-loglevel",
          "error",
          "-xerror",
          "-i",
          path.join(renditionDirectory, "index.m3u8"),
          "-ss",
          "3",
          "-frames:v",
          "1",
          "-f",
          "framehash",
          "-",
        ]);
        expect(frame).toMatch(/^0,/m);
        if (unsupportedSource) {
          await rm(path.join(renditionDirectory, "init.mp4"));
          await expect(
            runFfmpeg([
              "-hide_banner",
              "-loglevel",
              "error",
              "-xerror",
              "-i",
              path.join(renditionDirectory, "index.m3u8"),
              "-f",
              "null",
              "-",
            ]),
          ).rejects.toThrow();
        }
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
