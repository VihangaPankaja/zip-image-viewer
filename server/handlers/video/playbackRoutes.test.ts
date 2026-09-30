import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "../../domain/models.js";
import {
  parseRangeHeader,
  sanitizeEntryPath,
} from "../../infrastructure/runtime/runtimePrimitives.js";
import { registerVideoPlaybackRoutes } from "./playbackRoutes.js";
import type { VideoRouteDependencies } from "./types.js";

let directory = "";
const bytes = Buffer.from("original video bytes");
const getVideoMetadata = vi.fn<VideoRouteDependencies["getVideoMetadata"]>();
const prepareVideoRemux = vi.fn<VideoRouteDependencies["prepareVideoRemux"]>();

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "video-playback-"));
  await writeFile(path.join(directory, "clip.mp4"), bytes);
  getVideoMetadata.mockReset().mockRejectedValue(new Error("Probe failed"));
  prepareVideoRemux.mockReset().mockRejectedValue(new Error("Remux failed"));
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

function app() {
  const server = express();
  registerVideoPlaybackRoutes(server, {
    touchSession: () => ({ id: "session", extractDir: directory }) as Session,
    sanitizeEntryPath,
    parseRangeHeader,
    getVideoMetadata,
    prepareVideoRemux,
  } as unknown as VideoRouteDependencies);
  server.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: error.message });
    },
  );
  return server;
}

it.each([
  { range: "", status: 200, body: bytes, contentRange: undefined },
  {
    range: "bytes=2-7",
    status: 206,
    body: bytes.subarray(2, 8),
    contentRange: "bytes 2-7/20",
  },
  {
    range: "bytes=-4",
    status: 206,
    body: bytes.subarray(16),
    contentRange: "bytes 16-19/20",
  },
  {
    range: "bytes=50-60",
    status: 416,
    body: undefined,
    contentRange: "bytes */20",
  },
])(
  "keeps source streaming usable when probing fails ($range)",
  async ({ range, status, body, contentRange }) => {
    const response = await request(app())
      .get("/api/sessions/session/video/play")
      .query({ path: "clip.mp4", quality: "source" })
      .set("Range", range);
    expect(response.status).toBe(status);
    expect(response.headers["x-video-source"]).toBe("raw");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-range"]).toBe(contentRange);
    expect(response.headers["content-type"]).toMatch(/^video\/mp4/);
    if (body) expect(response.body).toEqual(body);
    expect(prepareVideoRemux).not.toHaveBeenCalled();
  },
);

it.each([500, 503])(
  "retains remux errors instead of streaming the raw file (%s)",
  async (status) => {
    if (status === 503)
      getVideoMetadata.mockResolvedValue({
        width: 640,
        height: 360,
        durationSeconds: 10,
        playbackMode: "remux",
      });
    const response = await request(app())
      .get("/api/sessions/session/video/play")
      .query({ path: "clip.mp4", quality: "remux" });
    expect(response.status).toBe(status);
    expect(response.headers["x-video-source"]).toBeUndefined();
    expect(response.body).toEqual({
      error:
        status === 500
          ? "Probe failed"
          : "Video remux failed. Try Auto playback.",
    });
  },
);
