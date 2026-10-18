import express from "express";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import type {
  Session,
  VideoTranscodeEntry,
} from "../../server/domain/models.js";
import {
  getVideoQualities,
  registerVideoMetadataRoutes,
} from "../../server/handlers/video/metadataRoutes.js";
import { registerVideoPlaybackRoutes } from "../../server/handlers/video/playbackRoutes.js";
import { registerVideoSubtitleRoute } from "../../server/handlers/video/subtitleRoute.js";
import { registerVideoHlsRoutes } from "../../server/handlers/videoHlsRoutes.js";
import { registerVideoThumbnailRoute } from "../../server/handlers/video/thumbnailRoute.js";
import type { VideoRouteDependencies } from "../../server/handlers/video/types.js";
import { createVideoRuntime } from "../../server/infrastructure/media/videoRuntime.js";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";
import {
  parseRangeHeader,
  sanitizeEntryPath,
} from "../../server/infrastructure/runtime/runtimePrimitives.js";
import { proxyApp } from "./proxyApp.js";
import { createDerivedMediaCache } from "../../server/infrastructure/media/derivedMediaCache.js";
import type { HlsEncoderPreference } from "../../server/config/runtimeConstants.js";

export async function startMultilingualFixture(
  baseURL: string,
  port = 0,
  durationSeconds = 20,
  height = 360,
  cacheBudgetBytes?: number,
  encoderPreference: HlsEncoderPreference = "cpu",
) {
  if (!ffmpegPath)
    throw new Error("FFmpeg is required for multilingual playback.");
  const directory = await mkdtemp(path.join(tmpdir(), "ziv-multilingual-"));
  const filename = "multilingual.mkv";
  const session = {
    id: "00000000-0000-4000-8000-000000000052",
    extractDir: directory,
    workspaceDir: directory,
  } as Session;
  const transcodes = new Map<string, VideoTranscodeEntry>();
  const encoderEvents: { event: string; details?: Record<string, unknown> }[] =
    [];
  const cache =
    cacheBudgetBytes === undefined
      ? undefined
      : createDerivedMediaCache(
          new Map([[session.id, session]]),
          transcodes,
          cacheBudgetBytes,
        );
  const runtime = createVideoRuntime({
    ffmpegPath,
    encoderPreference,
    transcodes,
    logEvent: (_level, event, details) => {
      if (event.startsWith("video.encoder."))
        encoderEvents.push({ event, details });
    },
    protectSession: cache?.protectSession,
    enforceDerivedMediaBudget: cache?.enforce,
    waitForEviction: cache?.waitForEviction,
  });
  try {
    const looped = durationSeconds > 120;
    const fixtureDuration = looped ? 16 : durationSeconds;
    for (const [language, text] of [
      ["eng", "English coastal captions"],
      ["spa", "Subtítulos de la costa"],
    ]) {
      await writeFile(
        path.join(directory, `${language}.srt`),
        `1\n00:00:00,000 --> 00:00:19,000\n${text}\n`,
      );
    }
    await runCommand(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${Math.round((height * 16) / 9 / 2) * 2}x${height}:rate=24:duration=${fixtureDuration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=48000:duration=${fixtureDuration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=880:sample_rate=48000:duration=${fixtureDuration}`,
      "-i",
      path.join(directory, "eng.srt"),
      "-i",
      path.join(directory, "spa.srt"),
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:a",
      "-map",
      "3:s",
      "-map",
      "4:s",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-c:s",
      "srt",
      ...(looped ? ["-t", String(fixtureDuration)] : []),
      "-metadata:s:a:0",
      "language=eng",
      "-metadata:s:a:0",
      "title=English",
      "-metadata:s:a:1",
      "language=spa",
      "-metadata:s:a:1",
      "title=Spanish",
      "-disposition:a:0",
      "default",
      "-disposition:a:1",
      "0",
      "-metadata:s:s:0",
      "language=eng",
      "-metadata:s:s:0",
      "title=English captions",
      "-metadata:s:s:1",
      "language=spa",
      "-metadata:s:s:1",
      "title=Spanish captions",
      path.join(directory, looped ? "seed.mkv" : filename),
    ]);
    if (looped)
      await runCommand(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-stream_loop",
        "-1",
        "-i",
        path.join(directory, "seed.mkv"),
        "-t",
        String(durationSeconds),
        "-map",
        "0:v",
        "-map",
        "0:a",
        "-c",
        "copy",
        path.join(directory, filename),
      ]);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const deps: VideoRouteDependencies = {
    getVideoMetadata: runtime.getVideoMetadata,
    buildVideoQualityOptions: runtime.buildVideoQualityOptions,
    getSessionQualityOutputPath: runtime.getSessionQualityOutputPath,
    prepareVideoRemux: runtime.prepareVideoRemux,
    ensureVideoTranscodeEntry: runtime.ensureVideoTranscodeEntry,
    getRenditionState: runtime.getRenditionState,
    startRenditionTranscode: runtime.startRenditionTranscode,
    startPrioritySegmentWindow: runtime.startPrioritySegmentWindow,
    refreshRenditionAvailability: runtime.refreshRenditionAvailability,
    getVideoTranscodeKey: runtime.getVideoTranscodeKey,
    ensureVideoStoryboard: runtime.ensureVideoStoryboard,
    trackVideoTask: runtime.trackVideoTask,
    runVideoTask: runtime.runVideoTask,
    runCommand: runtime.runCommand,
    waitForFile: runtime.waitForFile,
    getVideoDimensions: runtime.getVideoDimensions,
    DEFAULT_VIDEO_SEGMENT_SECONDS: runtime.segmentSeconds,
    parseSeekSeconds: (value) => Math.max(0, Number(value) || 0),
    logEvent: () => undefined,
    ffmpegPath,
    videoTranscodeStore: transcodes,
    touchSession: (id: string) => (id === session.id ? session : undefined),
    sanitizeEntryPath,
    parseRangeHeader,
    VIDEO_EXTENSIONS: new Set(["mkv"]),
  };
  const app = express();
  const requests: string[] = [];
  app.use((req, _res, next) => {
    requests.push(req.originalUrl);
    next();
  });
  app.post("/rpc/sessions/list", (_req, res) =>
    res.json({
      json: {
        items: [
          {
            id: session.id,
            firstFilePath: filename,
            fileCount: 1,
            lastAccessedAt: Date.now(),
          },
        ],
      },
    }),
  );
  app.post("/rpc/jobs/list", (_req, res) => res.json({ json: { items: [] } }));
  app.post("/rpc/scheduler/get", (_req, res) =>
    res.json({ json: { activeCount: 0, maxConcurrent: 2 } }),
  );
  app.post("/rpc/torrentLimits/get", (_req, res) =>
    res.json({ json: { downloadBytesPerSec: 0, uploadBytesPerSec: 0 } }),
  );
  app.post("/rpc/video/qualities", async (_req, res) =>
    res.json({
      json: await getVideoQualities(
        { sessionId: session.id, path: filename },
        deps,
      ),
    }),
  );
  app.get(`/api/sessions/${session.id}/tree`, (_req, res) =>
    res.json({
      id: session.id,
      firstFilePath: filename,
      tree: {
        name: filename,
        path: filename,
        extension: "mkv",
        type: "file",
        size: 1000000,
      },
    }),
  );
  registerVideoPlaybackRoutes(app, deps);
  registerVideoMetadataRoutes(app, deps);
  registerVideoSubtitleRoute(app, deps);
  registerVideoHlsRoutes(app, deps);
  registerVideoThumbnailRoute(app, deps);
  app.use(proxyApp(baseURL));
  const server = app.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Media fixture did not bind.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    encoderEvents,
    runtime,
    session,
    deps,
    directory,
    cache,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await runtime.cleanupVideoSession(session);
      await rm(directory, { recursive: true, force: true });
    },
  };
}
