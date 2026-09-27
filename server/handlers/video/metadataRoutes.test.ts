import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "../../domain/models.js";
import { sanitizeEntryPath } from "../../infrastructure/runtime/runtimePrimitives.js";
import {
  getVideoQualities,
  registerVideoMetadataRoutes,
} from "./metadataRoutes.js";
import type { VideoRouteDependencies } from "./types.js";

let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("shares quality metadata and file validation with the legacy HTTP endpoint", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "video-metadata-"));
  await writeFile(path.join(directory, "clip.mp4"), "video fixture");
  await writeFile(path.join(directory, "notes.txt"), "text fixture");
  const session = {
    id: "2bf886fc-65bf-4e2f-b973-b607766b3131",
    extractDir: directory,
    selectedVideoQuality: "720p",
  } as Session;
  const deps = {
    touchSession: (id: string) => (id === session.id ? session : undefined),
    sanitizeEntryPath,
    VIDEO_EXTENSIONS: new Set(["mp4"]),
    getVideoMetadata: vi.fn(() =>
      Promise.resolve({
        width: 640,
        height: 360,
        durationSeconds: 10,
      }),
    ),
    buildVideoQualityOptions: () => ({
      options: [
        { id: "source", label: "Original", height: null },
        { id: "360p", label: "360p", height: 360 },
      ],
      defaultQuality: "360p",
    }),
  };
  const input = { sessionId: session.id, path: "clip.mp4" };
  expect(await getVideoQualities(input, deps)).toMatchObject({
    path: "clip.mp4",
    defaultQuality: "360p",
    source: { height: 360 },
  });
  session.selectedVideoQuality = "source";
  expect(await getVideoQualities(input, deps)).toMatchObject({
    defaultQuality: "source",
  });
  const app = express();
  registerVideoMetadataRoutes(app, deps as unknown as VideoRouteDependencies);
  const url = "/api/sessions/" + session.id + "/video/qualities";
  const legacy = await request(app)
    .get(url)
    .query({ path: "clip.mp4" })
    .expect(200);
  expect(legacy.body).toEqual(await getVideoQualities(input, deps));
  for (const [file, status] of [
    ["../secret.mp4", 400],
    [".", 400],
    ["missing.mp4", 404],
    ["notes.txt", 400],
  ] as const) {
    await expect(
      getVideoQualities({ ...input, path: file }, deps),
    ).rejects.toMatchObject({ status });
    await request(app).get(url).query({ path: file }).expect(status);
  }
  await expect(
    getVideoQualities({ ...input, sessionId: "missing" }, deps),
  ).rejects.toMatchObject({ status: 404 });
});

it("reports queued encoder time", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_000);
  const app = express();
  registerVideoMetadataRoutes(app, {
    touchSession: () => ({ id: "session" }),
    sanitizeEntryPath: (path: string) => path,
    getVideoTranscodeKey: () => "key",
    videoTranscodeStore: new Map([
      [
        "key",
        {
          durationSeconds: 12,
          renditions: new Map([
            [
              "720p",
              {
                status: "queued",
                queuedAt: 900,
                expectedSegments: 3,
              },
            ],
          ]),
        },
      ],
    ]),
    refreshRenditionAvailability: () => Promise.resolve(0),
  } as unknown as VideoRouteDependencies);

  const response = await request(app).get(
    "/api/sessions/session/video/hls/status?path=private/video.mp4",
  );
  expect(response.status).toBe(200);
  const body = response.body as {
    status: string;
    renditions: { encoderWaitMs: number; status: string }[];
  };
  expect(body.status).toBe("queued");
  expect(body.renditions[0].encoderWaitMs).toBe(100);
  expect(body.renditions[0].status).toBe("queued");
  vi.restoreAllMocks();
});
