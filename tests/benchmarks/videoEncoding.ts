import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { cpus, platform, tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { HlsEncoder } from "../../server/infrastructure/media/hlsEncoder.js";
import {
  runCommand,
  runCommandCapture,
} from "../../server/infrastructure/process/commandRunner.js";
import {
  codecsFromInit,
  publishedSegments,
} from "../../server/media/hlsManifest.js";
import type { HlsEncoderPreference } from "../../server/config/runtimeConstants.js";

assert.ok(ffmpegPath, "The bundled FFmpeg binary is required.");
const executable = ffmpegPath;
const workspace = await mkdtemp(path.join(tmpdir(), "ziv-encoding-benchmark-"));
const source = path.join(workspace, "source.mkv");
const duration = 12;
const height = 720;
const rows = [];
try {
  await runCommand(executable, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=1280x${height}:rate=30:duration=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${duration}`,
    "-c:v",
    "ffv1",
    "-c:a",
    "pcm_s16le",
    source,
  ]);
  for (const preference of [
    "cpu",
    "h264_qsv",
    "h264_nvenc",
  ] as const satisfies readonly HlsEncoderPreference[]) {
    const events: { event: string; details?: Record<string, unknown> }[] = [];
    const encoder = new HlsEncoder(
      executable,
      preference,
      (_level, event, details) => events.push({ event, details }),
    );
    const elapsedMs = [];
    let output = "";
    for (let sample = 0; sample < 3; sample += 1) {
      output = path.join(workspace, `${preference}-${sample}`);
      await mkdir(output);
      const started = performance.now();
      await encoder.encode({
        inputPath: source,
        outputDirectory: output,
        height,
      });
      elapsedMs.push(Math.round(performance.now() - started));
    }
    const playlist = path.join(output, "index.m3u8");
    const text = await readFile(playlist, "utf8");
    assert.equal(publishedSegments(text).length, 3);
    assert.match(text, /#EXT-X-ENDLIST/);
    const codecs = codecsFromInit(
      await readFile(path.join(output, "init.mp4")),
    );
    assert.match(codecs ?? "", /^avc1\.4d[0-9a-f]{4},mp4a\.40\.2$/);
    const frame = await runCommandCapture(executable, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-xerror",
      "-err_detect",
      "explode",
      "-i",
      playlist,
      "-ss",
      "9",
      "-frames:v",
      "1",
      "-an",
      "-f",
      "framehash",
      "-",
    ]);
    assert.match(
      frame.stdout,
      /^0,/m,
      "A seek into the third segment must decode.",
    );
    const comparison = await runCommandCapture(executable, [
      "-hide_banner",
      "-i",
      source,
      "-i",
      playlist,
      "-lavfi",
      "[0:v]setpts=PTS-STARTPTS[ref];[1:v]setpts=PTS-STARTPTS[encoded];[ref][encoded]ssim",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    const ssim = Number(comparison.stderr.match(/All:([\d.]+)/)?.[1]);
    assert.ok(
      ssim > 0 && ssim <= 1,
      "SSIM must be measured against the same lossless source.",
    );
    const windowOutput = path.join(workspace, `${preference}-window`);
    await mkdir(windowOutput);
    await encoder.encode({
      inputPath: source,
      outputDirectory: windowOutput,
      height,
      window: { startSeconds: 8, durationSeconds: 4, startIndex: 2 },
    });
    const windowFrame = await runCommandCapture(executable, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-xerror",
      "-i",
      path.join(windowOutput, "index.m3u8"),
      "-frames:v",
      "1",
      "-an",
      "-f",
      "framehash",
      "-",
    ]);
    assert.match(
      windowFrame.stdout,
      /^0,/m,
      "A bounded window must decode independently.",
    );
    const sizes = await Promise.all(
      (await readdir(output)).map(
        async (name) => (await stat(path.join(output, name))).size,
      ),
    );
    const fallback = events.some(
      ({ event }) => event === "video.encoder.fallback",
    );
    rows.push({
      requested: preference,
      actual: preference === "cpu" || fallback ? "libx264" : preference,
      elapsedMs,
      warmMeanMs: Math.round((elapsedMs[1] + elapsedMs[2]) / 2),
      outputBytes: sizes.reduce((total, size) => total + size, 0),
      ssim,
      codecs,
      seekDecoded: true,
      boundedWindowDecoded: true,
      events,
    });
  }
  const report = {
    platform: platform(),
    cpu: cpus()[0].model,
    fixture: {
      width: 1280,
      height,
      fps: 30,
      durationSeconds: duration,
      video: "lossless FFV1",
      audio: "PCM 48 kHz",
    },
    note: "CPU fallback rows do not verify hardware encoding. Timings include staging and publication; the first sample also includes capability probes. GPU Docker verification is outside the accepted no-cost scope.",
    rows,
  };
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0) {
    const filename = process.argv[outputIndex + 1];
    assert.ok(filename, "--output requires a filename");
    await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
    await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(workspace, { recursive: true, force: true });
}
