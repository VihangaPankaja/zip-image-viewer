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
    workspaces.splice(0).map((workspace) =>
      rm(workspace, { recursive: true, force: true }),
    ),
  );
});

async function createThumbnailApp(
  runCommand: VideoRouteDependencies["runCommand"],
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
      Promise.resolve({ width: 1920, height: 1080, durationSeconds: 60 }),
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
      await writeFile(args.at(-1)!, "thumbnail");
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

  it("coalesces concurrent requests for the same cold thumbnail", async () => {
    let releaseGeneration!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const runCommand = vi.fn(async (_command: string, args: string[]) => {
      await generationStarted;
      await writeFile(args.at(-1)!, "thumbnail");
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
