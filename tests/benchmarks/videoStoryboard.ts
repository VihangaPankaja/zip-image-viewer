import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, platform, tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import ffmpegPath from "ffmpeg-static";
import { chromium, type Browser } from "@playwright/test";
import { build } from "vite";
import type { VideoStoryboard } from "../../shared/contracts.js";
import type {
  Session,
  VideoTranscodeEntry,
} from "../../server/domain/models.js";
import { createVideoRuntime } from "../../server/infrastructure/media/videoRuntime.js";
import { registerVideoRoutes } from "../../server/handlers/videoRoutes.js";
import {
  VIDEO_EXTENSIONS,
  parseSeekSeconds,
} from "../../server/infrastructure/runtime/mediaClassification.js";
import {
  parseRangeHeader,
  sanitizeEntryPath,
} from "../../server/infrastructure/runtime/runtimePrimitives.js";

if (!ffmpegPath) throw new Error("ffmpeg-static is required");
const executable = ffmpegPath;
const workspace = await mkdtemp(path.join(tmpdir(), "ziv-scrub-benchmark-"));
const session = {
  id: "benchmark",
  workspaceDir: workspace,
  extractDir: workspace,
} as Session;
const transcodes = new Map<string, VideoTranscodeEntry>();
const processStarts: number[] = [];
const loadSession = { ...session, id: "encoder-load" };
let load: Promise<PromiseSettledResult<void>[]> | undefined;
let completedLoadProcesses = 0;
const runtime = createVideoRuntime({
  ffmpegPath,
  transcodes,
  logEvent: (_level, event) => {
    if (event === "video.process.started")
      processStarts.push(performance.now());
  },
});
const app = express();
registerVideoRoutes(app, {
  ensureVideoStoryboard: runtime.ensureVideoStoryboard,
  runVideoTask: runtime.runVideoTask,
  trackVideoTask: runtime.trackVideoTask,
  getVideoMetadata: runtime.getVideoMetadata,
  getVideoDimensions: runtime.getVideoDimensions,
  getSessionQualityOutputPath: runtime.getSessionQualityOutputPath,
  buildVideoQualityOptions: runtime.buildVideoQualityOptions,
  ensureVideoTranscodeEntry: runtime.ensureVideoTranscodeEntry,
  getRenditionState: runtime.getRenditionState,
  startRenditionTranscode: runtime.startRenditionTranscode,
  startPrioritySegmentWindow: runtime.startPrioritySegmentWindow,
  refreshRenditionAvailability: runtime.refreshRenditionAvailability,
  getVideoTranscodeKey: runtime.getVideoTranscodeKey,
  runCommand: runtime.runCommand,
  waitForFile: runtime.waitForFile,
  ffmpegPath,
  VIDEO_EXTENSIONS,
  parseSeekSeconds,
  parseRangeHeader,
  sanitizeEntryPath,
  touchSession: (id) => (id === session.id ? session : undefined),
  videoTranscodeStore: transcodes,
  DEFAULT_VIDEO_SEGMENT_SECONDS: runtime.segmentSeconds,
  logEvent: () => undefined,
});
app.get("/scrubber", (_req, res) =>
  res
    .type("html")
    .send(
      '<html><head><link rel="stylesheet" href="/player.css"></head><body><main style="width:800px;padding-top:200px"><video muted controls preload="auto" style="width:640px" src="/api/sessions/benchmark/video/play?path=clip.mp4&amp;quality=source"></video><div id="root"></div></main><script type="module" src="/scrubber.js"></script></body></html>',
    ),
);
const harnessDirectory = path.join(workspace, "harness");
app.get("/player.css", (_req, res) =>
  res.sendFile(path.resolve("client/src/styles/player.css")),
);
app.use(express.static(harnessDirectory));
const server = createServer(app);
let browser: Browser | undefined;
const deadline = setTimeout(() => {
  process.stderr.write(
    "Storyboard benchmark exceeded its 120 second deadline.\n",
  );
  void browser?.close();
}, 120_000);
try {
  process.stderr.write("storyboard benchmark: building scrubber harness\n");
  await build({
    configFile: false,
    root: process.cwd(),
    logLevel: "warn",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: harnessDirectory,
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: path.resolve("tests/benchmarks/scrubberHarness.ts"),
        formats: ["es"],
        fileName: () => "scrubber.js",
      },
    },
  });
  process.stderr.write("storyboard benchmark: generating fixture\n");
  await runtime.runCommand(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=10:duration=150",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path.join(workspace, "clip.mp4"),
  ]);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server port missing");
  const origin = `http://127.0.0.1:${String(address.port)}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    process.stderr.write(error.stack ?? error.message);
  });
  process.stderr.write("storyboard benchmark: opening scrubber\n");
  await page.goto(`${origin}/scrubber`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const slider = page.getByRole("slider", { name: "Seek video" });
  await slider.waitFor();
  process.stderr.write("storyboard benchmark: generating cold storyboard\n");
  const coldStarted = performance.now();
  await slider.focus();
  await page.keyboard.down("ArrowRight");
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLImageElement>(".video-scrubber-preview img")
        ?.naturalWidth === 1600,
  );
  const coldStoryboardMs = performance.now() - coldStarted;
  await page.keyboard.up("ArrowRight");
  process.stderr.write("storyboard benchmark: occupying encoder slots\n");
  const beforeLoad = processStarts.length;
  load = Promise.allSettled(
    Array.from({ length: 2 }, () =>
      runtime
        .runCommand(
          executable,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=30:duration=60",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-f",
            "null",
            "-",
          ],
          loadSession,
        )
        .finally(() => {
          completedLoadProcesses += 1;
        }),
    ),
  );
  while (processStarts.length < beforeLoad + 2)
    await new Promise((resolve) => setTimeout(resolve, 10));
  const startsBeforeWarm = processStarts.length;
  process.stderr.write("storyboard benchmark: measuring warm responses\n");
  const warmRequests = await page.evaluate(async () => {
    const index = await fetch(
      "/api/sessions/benchmark/video/storyboard?path=clip.mp4",
    ).then((response) => response.json() as Promise<VideoStoryboard>);
    const urls = [
      ...new Set<number>(
        index.frames.map((frame: { sheet: number }) => frame.sheet),
      ),
    ].map(
      (sheet) =>
        `/api/sessions/benchmark/video/storyboard/sheet?path=clip.mp4&sheet=${String(sheet)}`,
    );
    for (const url of urls) {
      const image = new Image();
      image.src = url;
      await image.decode();
    }
    const samples: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const start = performance.now();
      await fetch(urls[i % urls.length], { cache: "reload" }).then((response) =>
        response.arrayBuffer(),
      );
      samples.push(performance.now() - start);
    }
    return samples;
  });
  process.stderr.write("storyboard benchmark: checking native playback\n");
  await page.evaluate(async () => {
    const video = document.querySelector("video");
    if (!video) throw new Error("Video missing");
    await video.play();
    await new Promise<void>((resolve) =>
      video.requestVideoFrameCallback(() => resolve()),
    );
    video.pause();
    video.currentTime = 4;
    await new Promise<void>((resolve) =>
      video.addEventListener("seeked", () => resolve(), { once: true }),
    );
    const measurement = {
      latencies: [] as number[],
      seeking: 0,
      initialTime: video.currentTime,
    };
    Object.assign(window, { scrubMeasurement: measurement });
    video.addEventListener("seeking", () => (measurement.seeking += 1));
    document.querySelector("input")?.addEventListener("input", () => {
      const start = performance.now();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const image = document.querySelector<HTMLImageElement>(
            ".video-scrubber-preview img",
          );
          void image
            ?.decode()
            .then(() => measurement.latencies.push(performance.now() - start));
        }),
      );
    });
  });
  process.stderr.write("storyboard benchmark: dragging for ten seconds\n");
  const box = await slider.boundingBox();
  if (!box) throw new Error("Missing scrubber");
  await page.mouse.move(box.x + (box.width * 4) / 150, box.y + box.height / 2);
  await page.mouse.down();
  const dragStart = performance.now();
  let moves = 0;
  while (performance.now() - dragStart < 10_000) {
    await page.mouse.move(
      box.x + 10 + ((moves * 17) % (box.width - 20)),
      box.y + box.height / 2,
    );
    moves += 1;
    await page.waitForTimeout(16);
  }
  const dragDurationMs = performance.now() - dragStart;
  const beforeCommit = await page.evaluate(() => ({
    ...(
      window as unknown as {
        scrubMeasurement: {
          latencies: number[];
          seeking: number;
          initialTime: number;
        };
      }
    ).scrubMeasurement,
    currentTime: document.querySelector("video")?.currentTime ?? -1,
  }));
  const target = Number(await slider.inputValue());
  await page.mouse.up();
  await page.waitForFunction(
    (time) =>
      Math.abs((document.querySelector("video")?.currentTime ?? -1) - time) <
      0.1,
    target,
  );
  const p95 = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const report = {
    generatedAt: new Date().toISOString(),
    machine: `${platform()} / ${cpus()[0]?.model}`,
    network: "unthrottled loopback",
    clip: "150s 640x360 H.264, 30 storyboard frames across 2 sheets",
    coldStoryboardMs,
    warmSheetSamples: warmRequests.length,
    warmSheetP95Ms: p95(warmRequests),
    dragDurationMs,
    moves,
    previewSamples: beforeCommit.latencies.length,
    previewP95Ms: p95(beforeCommit.latencies),
    seeksDuringDrag: beforeCommit.seeking,
    playbackTimeDuringDrag: beforeCommit.currentTime,
    committedTime: target,
    errors,
    competingFfmpegProcesses: 2 - completedLoadProcesses,
    ffmpegStartsDuringWarmDrag: processStarts.length - startsBeforeWarm,
  };
  const outputFlag = process.argv.indexOf("--output");
  const output = path.resolve(
    outputFlag >= 0
      ? process.argv[outputFlag + 1]
      : "test-results/storyboard-performance.json",
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (
    report.warmSheetP95Ms >= 100 ||
    report.previewP95Ms >= 100 ||
    report.previewSamples < 100 ||
    report.seeksDuringDrag !== 0 ||
    beforeCommit.currentTime !== beforeCommit.initialTime ||
    errors.length ||
    report.ffmpegStartsDuringWarmDrag !== 0 ||
    report.competingFfmpegProcesses !== 2
  )
    throw new Error("Storyboard performance acceptance failed");
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await runtime.cleanupVideoSession(session);
  await runtime.cleanupVideoSession(loadSession);
  await load;
  if (server.listening)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(workspace, { recursive: true, force: true });
}
