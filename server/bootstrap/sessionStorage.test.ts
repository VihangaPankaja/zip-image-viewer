import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, it, vi } from "vite-plus/test";
import type { Session } from "../domain/models.js";
import { createRuntimeMedia } from "./runtimeMedia.js";
import { createSessionStorage } from "../application/sessions/sessionStorage.js";

it("measures originals, pins the session and regenerates real previews after cache cleanup", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "session-storage-"));
  const extractDir = path.join(workspaceDir, "extracted");
  await mkdir(extractDir);
  const original = path.join(extractDir, "image.png");
  await sharp({
    create: { width: 16, height: 16, channels: 3, background: "red" },
  })
    .png()
    .toFile(original);
  const bytes = await readFile(original);
  const session = { id: "storage", workspaceDir, extractDir } as Session;
  const sessions = new Map([[session.id, session]]);
  const media = createRuntimeMedia(null, sessions, new Map(), vi.fn());
  const storage = createSessionStorage((id) => sessions.get(id), media);
  try {
    const preview = await media.ensureImagePreview(
      session,
      "image.png",
      original,
      "low",
    );
    const rendered = await readFile(preview);
    const before = await storage.get(session.id);
    expect(before.originalsBytes).toBe(bytes.length);
    expect(before.previewsBytes).toBeGreaterThan(0);
    storage.pin(session.id, true);
    expect((await storage.get(session.id)).pinned).toBe(true);
    await storage.clear(session.id);
    expect(await storage.get(session.id)).toMatchObject({
      originalsBytes: bytes.length,
      previewsBytes: 0,
      transcodesBytes: 0,
    });
    await expect(readFile(preview)).rejects.toMatchObject({ code: "ENOENT" });
    const regenerated = await media.ensureImagePreview(
      session,
      "image.png",
      original,
      "low",
    );
    expect(await readFile(regenerated)).toEqual(rendered);
    expect(await readFile(original)).toEqual(bytes);
    expect(() => storage.pin("missing", true)).toThrow("Session not found");
    await expect(storage.get("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  } finally {
    await media.videoRuntime.cleanupVideoSession(session);
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
