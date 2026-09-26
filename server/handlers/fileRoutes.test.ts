import express from "express";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "../domain/models.js";
import {
  formatBytes,
  parseRangeHeader,
  sanitizeEntryPath,
} from "../infrastructure/runtime/runtimePrimitives.js";
import {
  classifyMimeType,
  shouldPreserveOriginalPreview,
} from "../infrastructure/runtime/mediaClassification.js";
import { registerFileRoutes } from "./fileRoutes.js";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "file-routes-"));
  workspaces.push(dir);
  await writeFile(path.join(dir, "caption.txt"), "hello world");
  await writeFile(path.join(dir, "image.jpg"), "original image");
  await writeFile(path.join(dir, "image.gif"), "animated image");
  await writeFile(path.join(dir, "preview.jpg"), "converted image");
  const session = { id: "session", extractDir: dir } as Session;
  const deps = {
    touchSession: vi.fn((id: string) =>
      id === "session" ? session : undefined,
    ),
    logEvent: vi.fn(),
    sanitizeEntryPath,
    formatBytes,
    parseRangeHeader,
    classifyMimeType,
    shouldPreserveOriginalPreview,
    readPreviewChunk: vi.fn((targetPath: string) => readFile(targetPath)),
    ensureThumbnail: vi.fn(() =>
      Promise.resolve(path.join(dir, "preview.jpg")),
    ),
    ensureImagePreview: vi.fn(() =>
      Promise.resolve(path.join(dir, "preview.jpg")),
    ),
  };
  const app = express();
  registerFileRoutes(app, deps);
  return { app, deps, endpoint: "/api/sessions/session/file" };
}

it.each(["", ".", "../outside.txt", "missing.txt"])(
  "rejects invalid or missing files (%s)",
  async (file) => {
    const { app, endpoint } = await setup();
    await request(app)
      .get(endpoint)
      .query({ path: file })
      .expect(file === "missing.txt" ? 404 : 400);
  },
);

it("does not expose files from an expired session", async () => {
  const { app } = await setup();
  await request(app)
    .get("/api/sessions/expired/file")
    .query({ path: "caption.txt" })
    .expect(404);
});

it("serves complete files, previews and bounded byte ranges", async () => {
  const { app, endpoint } = await setup();
  const full = await request(app)
    .get(endpoint)
    .query({ path: "caption.txt" })
    .expect(200);
  expect(full.text).toBe("hello world");
  expect(full.headers["cache-control"]).toBe("no-store");
  const partial = await request(app)
    .get(endpoint)
    .query({ path: "caption.txt" })
    .set("Range", "bytes=6-10")
    .expect(206);
  expect(partial.text).toBe("world");
  expect(partial.headers["content-range"]).toBe("bytes 6-10/11");
  await request(app)
    .get(endpoint)
    .query({ path: "caption.txt" })
    .set("Range", "bytes=99-100")
    .expect(416);
  const preview = await request(app)
    .get(endpoint)
    .query({ path: "caption.txt", preview: "1" })
    .expect(200);
  expect(preview.text).toBe("hello world");
});

it.each(["thumbnail", "imagePreview"])(
  "rejects nonimages and falls back when %s conversion fails",
  async (mode) => {
    const { app, deps, endpoint } = await setup();
    await request(app)
      .get(endpoint)
      .query({ path: "caption.txt", [mode]: "1" })
      .expect(400);
    const converted = await request(app)
      .get(endpoint)
      .query({ path: "image.jpg", [mode]: "1" })
      .expect(200);
    expect(converted.body).toEqual(Buffer.from("converted image"));
    deps.ensureThumbnail.mockRejectedValue(new Error("Conversion failed"));
    deps.ensureImagePreview.mockRejectedValue(new Error("Conversion failed"));
    const original = await request(app)
      .get(endpoint)
      .query({ path: "image.jpg", [mode]: "1" })
      .expect(200);
    expect(original.body).toEqual(Buffer.from("original image"));
    expect(deps.logEvent).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("failed"),
      expect.objectContaining({ path: "image.jpg" }),
    );
  },
);

it("preserves animated originals during image preview", async () => {
  const { app, deps, endpoint } = await setup();
  const response = await request(app)
    .get(endpoint)
    .query({ path: "image.gif", imagePreview: "1" })
    .expect(200);
  expect(response.body).toEqual(Buffer.from("animated image"));
  expect(deps.ensureImagePreview).not.toHaveBeenCalled();
});
