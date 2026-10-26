import express from "express";
import { mkdtemp, rm, writeFile, readFile, symlink, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Session } from "../../../../server/domain/models.js";
import {
  formatBytes,
  parseRangeHeader,
  sanitizeEntryPath,
} from "../../../../server/infrastructure/runtime/runtimePrimitives.js";
import {
  classifyMimeType,
  shouldPreserveOriginalPreview,
} from "../../../../server/infrastructure/runtime/mediaClassification.js";
import { textPreviewSchema } from "../../../../shared/contracts.js";
import { registerFileRoutes } from "../../../../server/handlers/fileRoutes.js";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
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
    touchSession: vi.fn((id: string) => (id === "session" ? session : undefined)),
    logEvent: vi.fn(),
    sanitizeEntryPath,
    formatBytes,
    parseRangeHeader,
    classifyMimeType,
    shouldPreserveOriginalPreview,
    readPreviewChunk: vi.fn((targetPath: string) => readFile(targetPath)),
    ensureThumbnail: vi.fn(() => Promise.resolve(path.join(dir, "preview.jpg"))),
    ensureImagePreview: vi.fn(() => Promise.resolve(path.join(dir, "preview.jpg"))),
  };
  const app = express();
  registerFileRoutes(app, deps);
  return { app, deps, dir, endpoint: "/api/sessions/session/file" };
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
  await request(app).get("/api/sessions/expired/file").query({ path: "caption.txt" }).expect(404);
});

it("rejects a retained path linked into another session", async () => {
  const { app, deps, endpoint } = await setup();
  const other = await mkdtemp(path.join(tmpdir(), "other-session-"));
  workspaces.push(other);
  await writeFile(path.join(other, "private.txt"), "other session contents");
  const owner = deps.touchSession("session");
  if (!owner) throw new Error("Missing owner session");
  await symlink(other, path.join(owner.extractDir, "linked"), "junction");
  const response = await request(app).get(endpoint).query({ path: "linked/private.txt" });
  expect(response.status).toBe(400);
  expect(response.text).not.toContain("other session contents");
  expect(await readFile(path.join(other, "private.txt"), "utf8")).toBe("other session contents");
});

it("serves complete files, previews and bounded byte ranges", async () => {
  const { app, endpoint } = await setup();
  const full = await request(app).get(endpoint).query({ path: "caption.txt" }).expect(200);
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

it("opens a real 200 MB log with a bounded text chunk and navigates to its end", async () => {
  const { app, deps, dir, endpoint } = await setup();
  const file = await open(path.join(dir, "large.log"), "w");
  try {
    await file.write("first log line\n");
    await file.truncate(200 * 1024 * 1024);
    await file.write(Buffer.from("last log line\n"), 0, 14, 200 * 1024 * 1024 - 14);
  } finally {
    await file.close();
  }
  const first = await request(app).get(endpoint).query({ path: "large.log", textPreview: "1" });
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ totalBytes: 209715200, offset: 0, nextOffset: 131072 });
  expect(textPreviewSchema.parse(first.body).text.length).toBeLessThanOrEqual(131072);
  expect(textPreviewSchema.parse(first.body).text).toContain("first log line");
  const last = await request(app)
    .get(endpoint)
    .query({ path: "large.log", textPreview: "1", offset: "209715186" });
  expect(last.body).toMatchObject({ text: "last log line\n", nextOffset: 209715200 });
  expect(deps.readPreviewChunk).not.toHaveBeenCalled();
});

it.each(["-1", "1.5", "Infinity", "9007199254740992", "junk"])(
  "rejects invalid text byte offsets %s",
  async (offset) => {
    const { app, endpoint } = await setup();
    await request(app)
      .get(endpoint)
      .query({ path: "caption.txt", textPreview: "1", offset })
      .expect(400);
  },
);

it.each(["utf-8", "utf-16le", "utf-16be"] as const)(
  "keeps %s characters intact across chunk boundaries",
  async (encoding) => {
    const { app, dir, endpoint } = await setup();
    const text = "x".repeat(encoding === "utf-8" ? 131071 : 65534) + "😀tail";
    const bytes =
      encoding === "utf-8"
        ? Buffer.from(text)
        : Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    if (encoding === "utf-16be") bytes.swap16();
    await writeFile(path.join(dir, "unicode.txt"), bytes);
    const first = await request(app).get(endpoint).query({ path: "unicode.txt", textPreview: "1" });
    const next = await request(app)
      .get(endpoint)
      .query({
        path: "unicode.txt",
        textPreview: "1",
        offset: String(textPreviewSchema.parse(first.body).nextOffset),
      });
    expect(textPreviewSchema.parse(first.body).encoding).toBe(encoding);
    expect(textPreviewSchema.parse(first.body).text + textPreviewSchema.parse(next.body).text).toBe(
      text,
    );
    expect(textPreviewSchema.parse(first.body).replacementCharacters).toBe(false);
    expect(textPreviewSchema.parse(next.body).replacementCharacters).toBe(false);
  },
);

it("labels malformed text, binary content and empty files", async () => {
  const { app, dir, endpoint } = await setup();
  for (const [name, bytes, expected] of [
    ["bad.txt", Buffer.from([0x61, 0xff]), { replacementCharacters: true, binary: false }],
    ["binary.txt", Buffer.from([0, 1, 2, 3]), { binary: true }],
    ["empty.txt", Buffer.alloc(0), { text: "", totalBytes: 0, nextOffset: 0 }],
    ["bom.txt", Buffer.from([0xef, 0xbb, 0xbf, 0x61]), { text: "a", encoding: "utf-8" }],
  ] as const) {
    await writeFile(path.join(dir, name), bytes);
    const response = await request(app).get(endpoint).query({ path: name, textPreview: "1" });
    expect(response.body).toMatchObject(expected);
  }
});

it("makes bounded progress through runs of malformed UTF-8 continuation bytes", async () => {
  const { app, dir, endpoint } = await setup();
  await writeFile(path.join(dir, "malformed.txt"), Buffer.alloc(300000, 0x80));
  const response = await request(app)
    .get(endpoint)
    .query({ path: "malformed.txt", textPreview: "1", offset: "1" });
  const chunk = textPreviewSchema.parse(response.body);
  expect(chunk.nextOffset).toBeGreaterThan(1);
  expect(chunk.text).not.toBe("");
  expect(chunk.replacementCharacters).toBe(true);
});
