import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import request from "supertest";
import { expect, it, vi } from "vitest";
import type { Session } from "../../server/domain/models.js";
import { createVideoRuntime } from "../../server/infrastructure/media/videoRuntime.js";
import { registerVideoThumbnailRoute } from "../../server/handlers/video/thumbnailRoute.js";
import type { VideoRouteDependencies } from "../../server/handlers/video/types.js";
import { parseSeekSeconds } from "../../server/infrastructure/runtime/mediaClassification.js";
import { sanitizeEntryPath } from "../../server/infrastructure/runtime/runtimePrimitives.js";
import {
  generateStoryboard,
  storyboardDirectory,
  storyboardIndex,
} from "../../server/media/videoStoryboard.js";

it("bounds long-video sheets and keeps timestamp coordinates before EOF", () => {
  const index = storyboardIndex(36000);
  expect(index.frames).toHaveLength(240);
  expect(index.frames.at(-1)).toEqual({
    time: 35850,
    sheet: 9,
    x: 1280,
    y: 360,
  });
  expect(storyboardIndex(0.1).frames).toEqual([
    { time: 0, sheet: 0, x: 0, y: 0 },
  ]);
  expect(() => storyboardIndex(Infinity)).toThrow("duration");
});

it("coalesces real FFmpeg storyboards, publishes complete sheets and serves warm previews", async () => {
  if (!ffmpegPath)
    throw new Error("ffmpeg-static is required for media verification");
  const workspace = await mkdtemp(path.join(tmpdir(), "ziv-storyboard-"));
  const session = {
    id: "session",
    workspaceDir: workspace,
    extractDir: workspace,
  } as Session;
  const runtime = createVideoRuntime({
    ffmpegPath,
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  const target = path.join(workspace, "clip.mp4");
  try {
    await runtime.runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=10:duration=8",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      target,
    ]);
    const run = vi.spyOn(runtime, "runCommand");
    const [first, second] = await Promise.all([
      runtime.ensureVideoStoryboard(session, "clip.mp4", target),
      runtime.ensureVideoStoryboard(session, "clip.mp4", target),
    ]);
    expect(first).toBe(second);
    expect(run).toHaveBeenCalledTimes(1);
    expect(first.frames.map(({ time }) => time)).toEqual([0, 5]);
    const directory = storyboardDirectory(workspace, "clip.mp4");
    expect(
      JSON.parse(await readFile(path.join(directory, "index.json"), "utf8")),
    ).toEqual(first);
    expect(
      await sharp(path.join(directory, "sheet-1.jpg")).metadata(),
    ).toMatchObject({ width: 1600, height: 900 });
    const frame = await sharp(path.join(directory, "sheet-1.jpg"))
      .extract({ left: 320, top: 0, width: 320, height: 180 })
      .stats();
    expect(frame.channels.some(({ stdev }) => stdev > 10)).toBe(true);
    const app = express();
    registerVideoThumbnailRoute(app, {
      ensureVideoStoryboard: runtime.ensureVideoStoryboard,
      ffmpegPath,
      touchSession: () => session,
      sanitizeEntryPath,
      parseSeekSeconds,
    } as unknown as VideoRouteDependencies);
    await request(app)
      .get("/api/sessions/session/video/storyboard?path=clip.mp4")
      .expect(200);
    const sheetUrl =
      "/api/sessions/session/video/storyboard/sheet?path=clip.mp4&sheet=0";
    const sheet = await request(app).get(sheetUrl).expect(200);
    expect(sheet.type).toBe("image/jpeg");
    await request(app)
      .get(sheetUrl)
      .set("If-None-Match", sheet.headers.etag)
      .expect(304);
    await request(app)
      .get(sheetUrl.replace("sheet=0", "sheet=../1"))
      .expect(400);
    await request(app).get(sheetUrl.replace("sheet=0", "sheet=1")).expect(404);
    expect(run).toHaveBeenCalledTimes(1);
    await runtime.cleanupVideoSession(session);
    await expect(
      runtime.getVideoMetadata(target, session),
    ).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    await runtime.cleanupVideoSession(session);
    await rm(workspace, { recursive: true, force: true });
  }
}, 30_000);

it("reuses an on-disk index and removes failed partial sheets before retry", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "ziv-storyboard-failure-"),
  );
  const directory = path.join(workspace, "storyboard");
  const run = vi.fn(async () => {
    await writeFile(path.join(`${directory}.pending`, "sheet-1.jpg"), "");
  });
  try {
    expect(() => storyboardIndex(0)).toThrow("duration");
    await expect(generateStoryboard(directory, "clip", 8, run)).rejects.toThrow(
      "empty",
    );
    await expect(stat(`${directory}.pending`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    run.mockImplementation(async () => {
      await writeFile(
        path.join(`${directory}.pending`, "sheet-1.jpg"),
        "complete",
      );
    });
    const generated = await generateStoryboard(directory, "clip", 8, run);
    expect(await generateStoryboard(directory, "clip", 8, run)).toEqual(
      generated,
    );
    expect(run).toHaveBeenCalledTimes(2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
