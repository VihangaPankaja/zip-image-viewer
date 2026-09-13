import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { cpus, hostname, platform, release, tmpdir } from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import ffmpegPath from "ffmpeg-static";
import { chromium, type Page } from "@playwright/test";
import type {
  Session,
  VideoTranscodeEntry,
} from "../../server/domain/models.js";
import { registerVideoRoutes } from "../../server/handlers/videoRoutes.js";
import { createVideoRuntime } from "../../server/infrastructure/media/videoRuntime.js";
import {
  VIDEO_EXTENSIONS,
  parseSeekSeconds,
} from "../../server/infrastructure/runtime/mediaClassification.js";
import {
  parseRangeHeader,
  sanitizeEntryPath,
} from "../../server/infrastructure/runtime/runtimePrimitives.js";
import {
  renderVideoLatencyReport,
  summarizeVideoLatency,
  type VideoLatencyMode,
  type VideoLatencySample,
} from "./videoLatencyReport.js";

type BrowserMeasurement = Pick<
  VideoLatencySample,
  "startupMs" | "seekMs" | "bufferSeconds" | "transferMs"
>;

type TimingEvent = {
  event: string;
  details?: Record<string, unknown>;
};

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(argument(name, String(fallback)), 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function session(root: string, id: string): Session {
  return {
    id,
    workspaceDir: path.join(root, id),
    extractDir: path.join(root, "source"),
    tree: {
      name: "fixture.mp4",
      path: "fixture.mp4",
      type: "file",
      extension: "mp4",
      modifiedAt: 0,
    },
    firstFilePath: "fixture.mp4",
    stats: { fileCount: 1 },
    selectedVideoQuality: "360p",
    transcodeStatus: {
      quality: "360p",
      done: false,
      completed: 0,
      total: 1,
    },
    lastAccessedAt: Date.now(),
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Benchmark server did not expose a TCP port.");
  }
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for the video benchmark.");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

async function measure(
  page: Page,
  url: string,
  hls: boolean,
  seekSeconds: number,
): Promise<BrowserMeasurement> {
  const input = JSON.stringify({
    sourceUrl: url,
    useHls: hls,
    targetSeconds: seekSeconds,
  });
  return page.evaluate<BrowserMeasurement>(`(async () => {
      const { sourceUrl, useHls, targetSeconds } = ${input};
      const timeout = 45000;
      const event = (target, name) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Timed out waiting for " + name + ".")),
            timeout,
          );
          target.addEventListener(
            name,
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      const nextFrame = (video) =>
        new Promise((resolve) => {
          if (video.requestVideoFrameCallback) {
            video.requestVideoFrameCallback(() => resolve());
          } else requestAnimationFrame(() => resolve());
        });
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "auto";
      document.body.replaceChildren(video);
      performance.clearResourceTimings();

      let player;
      const startupStartedAt = performance.now();
      const canPlay = event(video, "canplay");
      if (useHls) {
        const Hls = window.Hls;
        player = new Hls({
          capLevelToPlayerSize: false,
          startLevel: 0,
          testBandwidth: false,
        });
        const attached = new Promise((resolve) => {
          player?.on(Hls.Events.MEDIA_ATTACHED, () => resolve());
        });
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            throw new Error(data.details ?? "Fatal HLS error.");
          }
        });
        player.attachMedia(video);
        await attached;
        player.loadSource(sourceUrl);
      } else {
        video.src = sourceUrl;
        video.load();
      }
      await canPlay;
      await video.play();
      await nextFrame(video);
      const startupMs = performance.now() - startupStartedAt;

      const seekStartedAt = performance.now();
      while (!Number.isFinite(video.duration) || video.duration < targetSeconds) {
        if (performance.now() - seekStartedAt > timeout) {
          throw new Error("Timed out waiting for the seek target.");
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const seeked = event(video, "seeked");
      video.currentTime = targetSeconds;
      await seeked;
      await video.play();
      await nextFrame(video);
      const seekMs = performance.now() - seekStartedAt;
      const bufferSeconds = video.buffered.length
        ? Math.max(0, video.buffered.end(video.buffered.length - 1) - video.currentTime)
        : 0;
      const transferMs = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/api/sessions/"))
        .reduce((total, entry) => total + entry.duration, 0);
      video.pause();
      player?.destroy();
      return { startupMs, seekMs, bufferSeconds, transferMs };
    })()`);
}

function addSample(
  samples: VideoLatencySample[],
  measurement: BrowserMeasurement,
  mode: VideoLatencyMode,
  encoderQueueMs: number,
): void {
  samples.push({
    mode,
    ...measurement,
    encoderQueueMs,
    encoderMs: 0,
    rendition: mode === "original" ? "source" : "360p",
    cache:
      mode === "original" ? "n/a" : mode === "prepared-hls" ? "hit" : "miss",
  });
}

async function main(): Promise<void> {
  if (!ffmpegPath) throw new Error("ffmpeg-static is unavailable.");
  const sampleCount = positiveInteger("--samples", 5);
  const durationSeconds = positiveInteger("--duration", 24);
  const outputPath = path.resolve(
    argument("--output", "docs/video-latency-baseline.md"),
  );
  const root = await mkdtemp(path.join(tmpdir(), "ziv-video-benchmark-"));
  const sourceDir = path.join(root, "source");
  const sourcePath = path.join(sourceDir, "fixture.mp4");
  const sessions = new Map<string, Session>();
  const transcodes = new Map<string, VideoTranscodeEntry>();
  const timingEvents: TimingEvent[] = [];
  const runtime = createVideoRuntime({
    ffmpegPath,
    transcodes,
    logEvent: (_level, event, details) => timingEvents.push({ event, details }),
  });
  const app: Express = express();
  app.get("/health", (_request, response) => response.json({ ok: true }));
  registerVideoRoutes(app, {
    touchSession: (id) => sessions.get(id),
    sanitizeEntryPath,
    getSessionQualityOutputPath: runtime.getSessionQualityOutputPath,
    parseRangeHeader,
    VIDEO_EXTENSIONS,
    getVideoMetadata: runtime.getVideoMetadata,
    buildVideoQualityOptions: runtime.buildVideoQualityOptions,
    parseSeekSeconds,
    ffmpegPath,
    ensureVideoTranscodeEntry: runtime.ensureVideoTranscodeEntry,
    getRenditionState: runtime.getRenditionState,
    startRenditionTranscode: runtime.startRenditionTranscode,
    startPrioritySegmentWindow: runtime.startPrioritySegmentWindow,
    refreshRenditionAvailability: runtime.refreshRenditionAvailability,
    DEFAULT_VIDEO_SEGMENT_SECONDS: runtime.segmentSeconds,
    runCommand: runtime.runCommand,
    getVideoTranscodeKey: runtime.getVideoTranscodeKey,
    videoTranscodeStore: transcodes,
    waitForFile: runtime.waitForFile,
    getVideoDimensions: runtime.getVideoDimensions,
    logEvent: () => undefined,
  });
  const server = createServer(app);
  let browser;
  try {
    await mkdir(sourceDir, { recursive: true });
    await runtime.runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=640x360:rate=30:duration=${String(durationSeconds)}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=1000:sample_rate=48000:duration=${String(durationSeconds)}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-shortest",
      sourcePath,
    ]);
    const prepared = session(root, "prepared");
    sessions.set(prepared.id, prepared);
    const preparedEntry = await runtime.ensureVideoTranscodeEntry(
      prepared,
      "fixture.mp4",
      sourcePath,
    );
    const preparedRendition = runtime.getRenditionState(
      preparedEntry,
      prepared,
      "360p",
    );
    await runtime.startRenditionTranscode(
      preparedEntry,
      prepared,
      preparedRendition,
    );
    await waitFor(() => preparedRendition.status === "done");

    const port = await listen(server);
    const origin = `http://127.0.0.1:${String(port)}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${origin}/health`);
    const require = createRequire(import.meta.url);
    await page.addScriptTag({
      path: require.resolve("hls.js/dist/hls.min.js"),
    });
    const samples: VideoLatencySample[] = [];
    const targetSeconds = durationSeconds * 0.8;

    for (let index = 0; index < sampleCount; index += 1) {
      addSample(
        samples,
        await measure(
          page,
          `${origin}/api/sessions/prepared/video/play?path=fixture.mp4&quality=source`,
          false,
          targetSeconds,
        ),
        "original",
        0,
      );
      addSample(
        samples,
        await measure(
          page,
          `${origin}/api/sessions/prepared/video/hls/master?path=fixture.mp4`,
          true,
          targetSeconds,
        ),
        "prepared-hls",
        0,
      );

      const cold = session(root, `cold-${String(index + 1)}`);
      sessions.set(cold.id, cold);
      addSample(
        samples,
        await measure(
          page,
          `${origin}/api/sessions/${cold.id}/video/hls/master?path=fixture.mp4`,
          true,
          targetSeconds,
        ),
        "cold-hls",
        0,
      );
      const coldEntry = transcodes.get(
        runtime.getVideoTranscodeKey(cold.id, "fixture.mp4"),
      );
      const coldRendition = coldEntry?.renditions.get("360p");
      await waitFor(() => coldRendition?.status === "done");
      const completed = timingEvents.find(
        ({ event, details }) =>
          event === "video.transcode.completed" &&
          details?.sessionId === cold.id,
      );
      const coldSample = samples.at(-1);
      if (!coldSample) throw new Error("Cold HLS sample was not recorded.");
      coldSample.encoderQueueMs = Number(completed?.details?.queueMs ?? 0);
      coldSample.encoderMs = Number(completed?.details?.encodeMs ?? 0);
    }

    const report = renderVideoLatencyReport({
      generatedAt: new Date().toISOString(),
      machine: `${hostname()} / ${platform()} ${release()} / ${cpus()[0]?.model ?? "unknown CPU"}`,
      network: "loopback, unthrottled",
      clip: `${String(durationSeconds)} s, 640x360 H.264/AAC deterministic fixture`,
      summaries: summarizeVideoLatency(samples),
      samples,
    });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, report, "utf8");
    process.stdout.write(report);
  } finally {
    await browser?.close();
    if (server.listening) await close(server);
    await rm(root, { recursive: true, force: true });
  }
}

await main();
