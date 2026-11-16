import express from "express";
import { mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import request from "supertest";
import unzipper from "unzipper";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Session } from "../../../../server/domain/models.js";
import { registerSelectionExportRoutes } from "../../../../server/handlers/selectionExport.js";
import { planSelectionExport } from "../../../../server/application/sessions/selectionExport.js";
import { streamSelectionZip } from "../../../../server/infrastructure/archive/streamSelectionZip.js";
import { createSessionManager } from "../../../../server/application/sessions/sessionManager.js";
import { request as httpRequest } from "node:http";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "selection-export-"));
  roots.push(root);
  await mkdir(path.join(root, "album/empty"), { recursive: true });
  await writeFile(path.join(root, "album/日本語.txt"), "unchanged Unicode contents");
  await writeFile(path.join(root, "clip.mp4"), Buffer.alloc(128 * 1024, 37));
  await writeFile(path.join(root, "unindexed-secret.txt"), "never export");
  const file = (name: string, size: number) => ({
    name: path.posix.basename(name),
    path: name,
    type: "file" as const,
    size,
    modifiedAt: 0,
  });
  const session = {
    id: "owned",
    extractDir: root,
    workspaceDir: root,
    tree: {
      name: "collection",
      path: ".",
      type: "directory",
      modifiedAt: 0,
      children: [
        {
          name: "album",
          path: "album",
          type: "directory",
          modifiedAt: 0,
          children: [
            file("album/日本語.txt", Buffer.byteLength("unchanged Unicode contents")),
            { name: "empty", path: "album/empty", type: "directory", modifiedAt: 0, children: [] },
          ],
        },
        file("clip.mp4", 128 * 1024),
      ],
    },
  } as Session;
  const sessions = new Map([[session.id, session]]);
  const app = express();
  app.use(express.json());
  registerSelectionExportRoutes(app, { touchSession: (id) => sessions.get(id) });
  return { app, session, root, sessions, endpoint: "/api/sessions/owned/export" };
}

it("streams a ZIP64 subset with identical hashes, root-relative paths, empty folders and deduplicated overlaps", async () => {
  const { app, root, endpoint } = await setup();
  const response = await request(app)
    .post(endpoint)
    .send({ paths: ["album", "album/日本語.txt", "clip.mp4"] })
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  expect(response.headers["content-disposition"]).toContain("attachment");
  const zip = await unzipper.Open.buffer(response.body as Buffer);
  expect(zip.files.map((entry) => entry.path)).toEqual([
    "album/",
    "album/日本語.txt",
    "album/empty/",
    "clip.mp4",
  ]);
  for (const entry of zip.files.filter((entry) => entry.type === "File")) {
    const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    expect(hash(await entry.buffer())).toBe(hash(await readFile(path.join(root, entry.path))));
    expect(entry.compressionMethod).toBe(0);
  }
});

it.each([
  "../clip.mp4",
  "/clip.mp4",
  "C:/clip.mp4",
  "album/../clip.mp4",
  "unindexed-secret.txt",
  "missing",
])("rejects unsafe or unowned selection %s", async (name) => {
  const { app, endpoint } = await setup();
  expect(
    (
      await request(app)
        .post(endpoint)
        .send({ paths: [name] })
    ).status,
  ).toBeGreaterThanOrEqual(400);
});

it("rejects deleted sessions and folders containing unavailable torrent entries", async () => {
  const { app, endpoint, session, sessions } = await setup();
  session.availablePaths = new Set(["clip.mp4"]);
  await request(app)
    .post(endpoint)
    .send({ paths: ["album"] })
    .expect(409);
  sessions.clear();
  await request(app)
    .post(endpoint)
    .send({ paths: ["clip.mp4"] })
    .expect(404);
});

it("rejects symlink escapes and portable case collisions before writing ZIP bytes", async () => {
  const { app, root, session, endpoint } = await setup();
  const outside = await mkdtemp(path.join(tmpdir(), "export-other-owner-"));
  roots.push(outside);
  await writeFile(path.join(outside, "日本語.txt"), "another owner's secret");
  await rm(path.join(root, "album"), { recursive: true });
  await symlink(outside, path.join(root, "album"), "junction");
  await request(app)
    .post(endpoint)
    .send({ paths: ["album"] })
    .expect(400);
  await writeFile(path.join(root, "CLIP.mp4"), "collision");
  session.tree.children?.push({ name: "CLIP.mp4", path: "CLIP.mp4", type: "file", modifiedAt: 0 });
  const response = await request(app)
    .post(endpoint)
    .send({ paths: ["clip.mp4", "CLIP.mp4"] })
    .expect(413);
  expect(response.text).toMatch(/collision/i);
});

it("requires large-export confirmation, bounds payload and accepts a native POST form", async () => {
  const { app, root, session, endpoint } = await setup();
  const file = await open(path.join(root, "clip.mp4"), "r+");
  try {
    await file.truncate(512 * 1024 ** 2);
    const plan = await request(app)
      .post(`${endpoint}/plan`)
      .send({ paths: ["clip.mp4"] })
      .expect(200);
    expect(plan.body).toEqual({ entries: 1, bytes: 512 * 1024 ** 2, requiresConfirmation: true });
    await request(app)
      .post(endpoint)
      .send({ paths: ["clip.mp4"] })
      .expect(409);
    await file.truncate(10 * 1024 ** 3 + 1);
    await request(app)
      .post(`${endpoint}/plan`)
      .send({ paths: ["clip.mp4"] })
      .expect(413);
    await file.truncate(0);
  } finally {
    await file.close();
  }
  await request(app)
    .post(endpoint)
    .type("form")
    .send({ selection: JSON.stringify({ paths: ["clip.mp4"] }) })
    .expect(200);
  expect(session.archiveOperations?.size).toBe(0);
});

it("stops reading on generator cancellation and rejects a changed source", async () => {
  const { root, session } = await setup();
  const file = await open(path.join(root, "clip.mp4"), "r+");
  await file.truncate(16 * 1024 ** 2);
  await file.close();
  const controller = new AbortController();
  const plan = await planSelectionExport(session, ["clip.mp4"], controller.signal);
  const zip = streamSelectionZip(plan.entries, plan.root, controller.signal);
  expect((await zip.next()).value?.length).toBeLessThan(500);
  expect((await zip.next()).value?.length).toBe(64 * 1024);
  controller.abort();
  await expect(zip.next()).rejects.toThrow();
  // A closed descriptor allows Windows to remove the source immediately.
  await rm(path.join(root, "clip.mp4"));
  await writeFile(path.join(root, "clip.mp4"), "replacement");
  const changed = streamSelectionZip(plan.entries, plan.root, new AbortController().signal);
  await changed.next();
  await expect(changed.next()).rejects.toThrow(/changed/);
});

it("bounds concurrent slow clients, releases a disconnected slot and drains exports on session deletion", async () => {
  const { app, root, session, sessions, endpoint } = await setup();
  const file = await open(path.join(root, "clip.mp4"), "r+");
  await file.truncate(128 * 1024 ** 2);
  await file.close();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  const clients: ReturnType<typeof httpRequest>[] = [];
  const connect = async () => {
    const client = httpRequest(`http://127.0.0.1:${address.port}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    clients.push(client);
    client.on("error", () => undefined);
    client.end(JSON.stringify({ paths: ["clip.mp4"] }));
    const response = await new Promise<IncomingMessage>((resolve) =>
      client.once("response", resolve),
    );
    response.on("error", () => undefined);
    response.pause();
    return response;
  };
  try {
    const memoryBefore = process.memoryUsage().rss;
    const first = await connect();
    const second = await connect();
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    await request(app)
      .post(endpoint)
      .send({ paths: ["clip.mp4"] })
      .expect(429);
    expect(session.archiveOperations?.size).toBe(2);
    expect(process.memoryUsage().rss - memoryBefore).toBeLessThan(64 * 1024 ** 2);
    first.destroy();
    await vi.waitFor(() => expect(session.archiveOperations?.size).toBe(1));
    await request(app)
      .post(`${endpoint}/plan`)
      .send({ paths: ["clip.mp4"] })
      .expect(200);
    const cleanup = vi.fn(() => Promise.resolve());
    const manager = createSessionManager(sessions, new Map(), vi.fn(), cleanup);
    await manager.removeSession(session.id);
    expect(session.archiveOperations?.size).toBe(0);
    expect(cleanup).toHaveBeenCalledOnce();
    await request(app)
      .post(endpoint)
      .send({ paths: ["clip.mp4"] })
      .expect(404);
  } finally {
    for (const client of clients) client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
