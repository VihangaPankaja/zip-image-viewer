import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import ffmpegPath from "ffmpeg-static";
// The production build exists only after the CI dead-code check.
const mediaModule = (name) =>
  pathToFileURL(path.join(process.cwd(), "build/server/media", name)).href;
const { buildFmp4HlsArgs } = await import(mediaModule("ffmpegHls.js"));
const { publishedSegments } = await import(mediaModule("hlsManifest.js"));

assert.ok(ffmpegPath, "Production FFmpeg binary is missing");
const workspace = mkdtempSync(path.join(tmpdir(), "ziv-container-hls-"));
const source = path.join(workspace, "source.mp4");
const rendition = path.join(workspace, "360p");
mkdirSync(rendition);

try {
  execFileSync(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24:duration=5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  execFileSync(
    ffmpegPath,
    buildFmp4HlsArgs({
      inputPath: source,
      outputDirectory: rendition,
      height: 360,
      segmentDurationSeconds: 2,
    }),
  );
  const playlist = readFileSync(path.join(rendition, "index.m3u8"), "utf8");
  assert.ok(publishedSegments(playlist).length > 1, "HLS segments are missing");
  assert.match(playlist, /#EXT-X-ENDLIST/);
  const frame = execFileSync(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-xerror",
      "-err_detect",
      "explode",
      "-i",
      path.join(rendition, "index.m3u8"),
      "-ss",
      "3",
      "-frames:v",
      "1",
      "-f",
      "framehash",
      "-",
    ],
    { encoding: "utf8" },
  );
  assert.match(frame, /^0,/m, "Seeking did not decode a video frame");
  process.stdout.write("Container HLS smoke passed.\n");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
