import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import ffmpegPath from "ffmpeg-static";
import request from "supertest";
import { afterEach, expect, it } from "vitest";
import type {
  Session,
  VideoTranscodeEntry,
} from "../../server/domain/models.js";
import { registerVideoPlaybackRoutes } from "../../server/handlers/video/playbackRoutes.js";
import { registerVideoHlsRoutes } from "../../server/handlers/videoHlsRoutes.js";
import { getVideoQualities } from "../../server/handlers/video/metadataRoutes.js";
import type { VideoRouteDependencies } from "../../server/handlers/video/types.js";
import { createVideoRuntime } from "../../server/infrastructure/media/videoRuntime.js";
import {
  parseRangeHeader,
  sanitizeEntryPath,
} from "../../server/infrastructure/runtime/runtimePrimitives.js";
import {
  runCommand,
  runCommandCapture,
} from "../../server/infrastructure/process/commandRunner.js";

let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("serves MP4 ranges without encoding, remuxes without changing packets, and transcodes unsupported video", async () => {
  if (!ffmpegPath) throw new Error("ffmpeg-static is unavailable");
  const executable = ffmpegPath;
  directory = await mkdtemp(path.join(os.tmpdir(), "video-modes-"));
  const mp4 = path.join(directory, "direct.mp4");
  const mkv = path.join(directory, "remux.mkv");
  const unsupported = path.join(directory, "unsupported.mp4");
  await runCommand(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=24:duration=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    mp4,
  ]);
  await runCommand(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    mp4,
    "-c",
    "copy",
    mkv,
  ]);
  await runCommand(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    mp4,
    "-c:v",
    "mpeg4",
    "-c:a",
    "copy",
    unsupported,
  ]);
  const session = {
    id: "session",
    extractDir: directory,
    workspaceDir: directory,
  } as Session;
  const transcodes = new Map<string, VideoTranscodeEntry>();
  const runtime = createVideoRuntime({
    ffmpegPath,
    transcodes,
    logEvent: () => undefined,
  });
  expect((await runtime.getVideoMetadata(mp4, session)).playbackMode).toBe(
    "direct",
  );
  expect((await runtime.getVideoMetadata(mkv, session)).playbackMode).toBe(
    "remux",
  );
  expect(
    (await runtime.getVideoMetadata(unsupported, session)).playbackMode,
  ).toBe("transcode");

  const app = express();
  const deps = {
    getVideoMetadata: runtime.getVideoMetadata,
    buildVideoQualityOptions: runtime.buildVideoQualityOptions,
    getSessionQualityOutputPath: runtime.getSessionQualityOutputPath,
    prepareVideoRemux: runtime.prepareVideoRemux,
    ensureVideoTranscodeEntry: runtime.ensureVideoTranscodeEntry,
    getRenditionState: runtime.getRenditionState,
    startRenditionTranscode: runtime.startRenditionTranscode,
    touchSession: () => session,
    sanitizeEntryPath,
    parseRangeHeader,
    VIDEO_EXTENSIONS: new Set(["mp4", "mkv"]),
    ffmpegPath,
  } as unknown as VideoRouteDependencies;
  registerVideoPlaybackRoutes(app, deps);
  registerVideoHlsRoutes(app, deps);
  const base = "/api/sessions/session/video/play";
  const direct = await request(app)
    .get(base)
    .query({ path: "direct.mp4", quality: "source" })
    .set("Range", "bytes=0-31");
  expect(direct.status).toBe(206);
  expect(direct.headers["content-range"]).toMatch(/^bytes 0-31\//);
  expect(direct.headers["x-video-source"]).toBe("direct");
  expect(direct.headers["content-type"]).toMatch(/^video\/mp4/);
  expect(
    await getVideoQualities(
      { sessionId: session.id, path: "direct.mp4" },
      deps,
    ),
  ).toMatchObject({
    defaultQuality: "source",
    options: [{ id: "source", label: "Direct play" }, { id: "auto" }],
  });
  expect(transcodes.size).toBe(0);
  const withoutFfmpeg = createVideoRuntime({
    ffmpegPath: null,
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  expect(
    await getVideoQualities(
      { sessionId: session.id, path: "direct.mp4" },
      {
        ...deps,
        getVideoMetadata: withoutFfmpeg.getVideoMetadata,
        buildVideoQualityOptions: withoutFfmpeg.buildVideoQualityOptions,
      },
    ),
  ).toMatchObject({
    defaultQuality: "source",
    options: [{ id: "source", label: "Original" }],
  });
  const remux = await request(app)
    .get(base)
    .query({ path: "remux.mkv", quality: "remux" })
    .set("Range", "bytes=0-31");
  expect(remux.status).toBe(206);
  expect(remux.headers["content-range"]).toMatch(/^bytes 0-31\//);
  expect(remux.headers["x-video-source"]).toBe("remux");
  expect(remux.headers["content-type"]).toMatch(/^video\/mp4/);
  expect(
    (
      await runtime.getVideoMetadata(
        runtime.getSessionQualityOutputPath(session, "remux.mkv", "remux"),
        session,
      )
    ).playbackMode,
  ).toBe("direct");
  const packetHash = async (file: string) =>
    (
      await runCommandCapture(executable, [
        "-v",
        "error",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-c",
        "copy",
        "-f",
        "streamhash",
        "-",
      ])
    ).stdout;
  expect(
    await packetHash(
      runtime.getSessionQualityOutputPath(session, "remux.mkv", "remux"),
    ),
  ).toBe(await packetHash(mkv));
  expect(transcodes.size).toBe(0);
  expect(
    await getVideoQualities(
      { sessionId: session.id, path: "unsupported.mp4" },
      deps,
    ),
  ).toMatchObject({
    defaultQuality: "auto",
    options: [{ id: "source" }, { id: "auto" }],
  });
  const hls = "/api/sessions/session/video/hls";
  const master = await request(app)
    .get(`${hls}/master`)
    .query({ path: "unsupported.mp4" })
    .expect(200);
  expect(master.text).toContain("quality=source");
  await request(app)
    .get(`${hls}/playlist`)
    .query({ path: "unsupported.mp4", quality: "source" })
    .expect(200);
  await request(app)
    .get(`${hls}/init`)
    .query({ path: "unsupported.mp4", quality: "source" })
    .expect(200);
  await request(app)
    .get(`${hls}/segment`)
    .query({ path: "unsupported.mp4", quality: "source", index: 0 })
    .expect(200);
  const entry = await runtime.ensureVideoTranscodeEntry(
    session,
    "unsupported.mp4",
    unsupported,
  );
  const rendition = runtime.getRenditionState(entry, session, "source");
  const init = await readFile(path.join(rendition.dir, "init.mp4"));
  expect(init.includes("avcC")).toBe(true);
  expect(init.includes("mp4a")).toBe(true);
  const decoded = await runCommandCapture(ffmpegPath, [
    "-v",
    "error",
    "-i",
    rendition.playlistPath,
    "-f",
    "null",
    "-",
  ]);
  expect(decoded.stderr).toBe("");
  await runtime.cleanupVideoSession(session);
}, 30_000);
