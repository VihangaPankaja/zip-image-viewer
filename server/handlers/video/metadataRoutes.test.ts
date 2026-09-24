import express from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { registerVideoMetadataRoutes } from "./metadataRoutes.js";
import type { VideoRouteDependencies } from "./types.js";

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
