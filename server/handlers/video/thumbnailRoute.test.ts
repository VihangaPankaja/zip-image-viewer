import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../domain/models.js";
import { registerVideoThumbnailRoute } from "./thumbnailRoute.js";
import type { VideoRouteDependencies } from "./types.js";

const workspaces: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    workspaces
      .splice(0)
      .map((workspace) => rm(workspace, { recursive: true, force: true })),
  );
});

async function createThumbnailApp(
  runCommand: VideoRouteDependencies["runCommand"],
  durationSeconds = 60,
) {
  const workspace = await mkdtemp(path.join(tmpdir(), "ziv-thumbnail-route-"));
  workspaces.push(workspace);
  await writeFile(path.join(workspace, "source.mp4"), "source");
  const session = {
    id: "session",
    extractDir: workspace,
    workspaceDir: workspace,
  } as Session;
  const app = express();
  registerVideoThumbnailRoute(app, {
    ffmpegPath: "ffmpeg",
    touchSession: () => session,
    sanitizeEntryPath: (value: string) => value,
    parseSeekSeconds: (value: unknown) => Number(value),
    getVideoMetadata: () =>
      Promise.resolve({ width: 1920, height: 1080, durationSeconds }),
    buildVideoQualityOptions: () => ({
      options: [{ id: "360p", label: "360p", height: 360 }],
      defaultQuality: "360p",
    }),
    runCommand,
  } as unknown as VideoRouteDependencies);
  return app;
}

describe("video thumbnail route", () => {
  it("reuses a generated thumbnail with stable cache validators", async () => {
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      await writeFile(String(args.at(-1)), "thumbnail");
    });
    const app = await createThumbnailApp(runCommand);
    const resource =
      "/api/sessions/session/video/thumbnail?path=source.mp4&quality=360p&width=240&time=4.24";

    const first = await request(app).get(resource).expect(200);
    expect(first.headers["cache-control"]).toContain("immutable");
    expect(first.headers.etag).toBeTruthy();

    const second = await request(app)
      .get(resource)
      .set("If-None-Match", first.headers.etag)
      .expect(304);
    expect(second.headers.etag).toBe(first.headers.etag);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-progress thumbnail even after the output file appears", async () => {
    let finishGeneration!: () => void;
    const finishing = new Promise<void>((resolve) => {
      finishGeneration = resolve;
    });
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      await writeFile(String(args.at(-1)), "partial");
      await finishing;
      await writeFile(String(args.at(-1)), "complete");
    });
    const app = await createThumbnailApp(runCommand);
    const resource =
      "/api/sessions/session/video/thumbnail?path=source.mp4&time=5";
    const first = request(app)
      .get(resource)
      .then((response) => response);
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalled());
    let secondFinished = false;
    const second = request(app)
      .get(resource)
      .then((response) => {
        secondFinished = true;
        return response;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(secondFinished).toBe(false);
    } finally {
      finishGeneration();
      const responses = await Promise.all([first, second]);
      for (const response of responses)
        expect(
          Buffer.isBuffer(response.body) ? response.body.toString() : null,
        ).toBe("complete");
    }
  });

  it.each([7.99, 8, 10])(
    "keeps a thumbnail request at %s inside the video duration",
    async (time) => {
      const runCommand = vi.fn(async (_command: string, args: string[]) => {
        const seek = Number(args[args.indexOf("-ss") + 1]);
        if (seek >= 8) throw new Error("No frame exists at or beyond EOF");
        await writeFile(String(args.at(-1)), "thumbnail");
      });
      const app = await createThumbnailApp(runCommand, 8);
      await request(app)
        .get(
          `/api/sessions/session/video/thumbnail?path=source.mp4&time=${time}`,
        )
        .expect(200);
    },
  );

  it("coalesces concurrent requests for the same cold thumbnail", async () => {
    let releaseGeneration!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      await generationStarted;
      await writeFile(String(args.at(-1)), "thumbnail");
    });
    const app = await createThumbnailApp(runCommand);
    const resource =
      "/api/sessions/session/video/thumbnail?path=source.mp4&quality=360p&width=320&time=8";

    const responses = Promise.all([
      request(app).get(resource),
      request(app).get(resource),
      request(app).get(resource),
    ]);
    await vi.waitFor(() => expect(runCommand).toHaveBeenCalled());
    releaseGeneration();

    for (const response of await responses) {
      expect(response.status).toBe(200);
      expect(response.type).toBe("image/jpeg");
    }
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
