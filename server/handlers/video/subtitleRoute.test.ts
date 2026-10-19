import express from "express";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Session } from "../../domain/models.js";
import { sanitizeEntryPath } from "../../infrastructure/runtime/runtimePrimitives.js";
import type { VideoRouteDependencies } from "./types.js";
import type { runCommandCapture } from "../../infrastructure/process/commandRunner.js";
import { registerVideoSubtitleRoute } from "./subtitleRoute.js";

const capture = vi.hoisted(() =>
  vi.fn<typeof runCommandCapture>(() =>
    Promise.resolve({
      stdout: "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n",
      stderr: "",
    }),
  ),
);
vi.mock("../../infrastructure/process/commandRunner.js", () => ({
  runCommandCapture: capture,
}));
let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  capture.mockClear();
});

it("validates available files and text stream IDs before converting through the media limiter", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "video-subtitle-route-"));
  await writeFile(path.join(directory, "clip.mkv"), "fixture");
  const session = {
    id: "session",
    extractDir: directory,
    availablePaths: new Set(["clip.mkv"]),
  } as Session;
  const runVideoTask = vi.fn(
    <Result>(
      _session: Session | undefined,
      task: (_signal?: AbortSignal) => Promise<Result>,
      signal?: AbortSignal,
    ) => task(signal),
  );
  const app = express();
  registerVideoSubtitleRoute(app, {
    touchSession: (id: string) => (id === session.id ? session : undefined),
    sanitizeEntryPath,
    ffmpegPath: "ffmpeg",
    getVideoMetadata: () =>
      Promise.resolve({
        width: 640,
        height: 360,
        durationSeconds: 1,
        subtitleTracks: [
          {
            id: "subtitle-3",
            index: 3,
            language: "eng",
            label: "English",
            isDefault: true,
          },
        ],
      }),
    runVideoTask,
  } as unknown as VideoRouteDependencies);
  const url = "/api/sessions/session/video/subtitles";
  for (const [query, status] of [
    [{ path: "clip.mkv", track: "subtitle-99" }, 400],
    [{ path: "clip.mkv", track: "audio-3" }, 400],
    [{ path: "../clip.mkv", track: "subtitle-3" }, 400],
    [{ path: "missing.mkv", track: "subtitle-3" }, 404],
  ] as const)
    await request(app).get(url).query(query).expect(status);
  expect(capture).not.toHaveBeenCalled();
  const converted = await request(app)
    .get(url)
    .query({ path: "clip.mkv", track: "subtitle-3" })
    .expect(200);
  expect(converted.headers["content-type"]).toContain("text/vtt");
  expect(converted.text).toContain("Hello");
  expect(runVideoTask).toHaveBeenCalledOnce();
  expect(capture.mock.calls[0]?.[1]).toContain("0:3");
  capture.mockRejectedValueOnce(new Error(`private failure: ${directory}`));
  const failure = await request(app)
    .get(url)
    .query({ path: "clip.mkv", track: "subtitle-3" })
    .expect(422);
  expect(failure.text).not.toContain(directory);
  capture.mockResolvedValueOnce({
    stdout: "x".repeat(2 * 1024 ** 2 + 1),
    stderr: "",
  });
  await request(app).get(url).query({ path: "clip.mkv", track: "subtitle-3" }).expect(422);
  session.availablePaths = new Set();
  await request(app).get(url).query({ path: "clip.mkv", track: "subtitle-3" }).expect(404);
});
