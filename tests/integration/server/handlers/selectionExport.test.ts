import express from "express";
import { mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import request from "supertest";
import unzipper from "unzipper";
import { path7za } from "7zip-bin";
import { runCommand } from "../../../../server/infrastructure/process/commandRunner.js";
import { extractZip } from "../../../../server/infrastructure/archive/extractZip.js";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { Session } from "../../../../server/domain/models.js";
import { registerSelectionExportRoutes } from "../../../../server/handlers/selectionExport.js";
import { planSelectionExport } from "../../../../server/application/sessions/selectionExport.js";
import * as exportPlanning from "../../../../server/application/sessions/selectionExport.js";
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
  app.use(express.json({ limit: "1mb" }));
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
  const output = response.body as Buffer;
  expect(output.readUInt16LE(output.length - 12)).toBe(4);
  expect(output.readUInt32LE(output.length - 6)).toBeLessThan(output.length);
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
  const archive = path.join(root, "selection.zip");
  await writeFile(archive, response.body as Buffer);
  for (const reader of ["native", "app"]) {
    const output = path.join(root, reader);
    await mkdir(output);
    if (reader === "native") await runCommand(path7za, ["x", "-y", `-o${output}`, archive]);
    else await extractZip(archive, output, undefined, () => {});
    for (const name of ["album/日本語.txt", "clip.mp4"])
      expect(await readFile(path.join(output, name))).toEqual(
        await readFile(path.join(root, name)),
      );
  }
});

it.each([
  "../clip.mp4",
  "/clip.mp4",
  "C:/clip.mp4",
  "album/../clip.mp4",
  "unindexed-secret.txt",
  "missing",
  "album\\日本語.txt",
  "clip.mp4\u0000",
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

it("bounds metadata before resolving sources, rejects empty inputs and emits 64-bit sizes beyond 4 GiB", async () => {
  const { app, session, root, endpoint } = await setup();
  await request(app).post(endpoint).send({ paths: [] }).expect(400);
  await request(app).post(endpoint).type("form").send({ selection: "invalid-json" }).expect(400);
  const file = await open(path.join(root, "clip.mp4"), "r+");
  await file.truncate(4 * 1024 ** 3 + 1);
  await file.close();
  const signal = new AbortController().signal;
  const plan = await planSelectionExport(session, ["clip.mp4"], signal);
  const zip = streamSelectionZip(plan.entries, plan.root, signal);
  const first = await zip.next();
  if (!first.value) throw new Error("Missing ZIP header");
  expect(first.value.readUInt32LE(18)).toBe(0xffffffff);
  const extraStart = 30 + first.value.readUInt16LE(26);
  expect(first.value.readBigUInt64LE(extraStart + 4)).toBe(4n * 1024n ** 3n + 1n);
  await zip.return();
  session.tree.children = Array.from({ length: 2200 }, (_, i) => ({
    name: `${i}`,
    path: `${i}${"x".repeat(4090)}`,
    type: "file",
    modifiedAt: 0,
  }));
  await request(app)
    .post(endpoint)
    .send({ paths: ["."] })
    .expect(413);
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

it("closes the HTTP response when session cleanup aborts export preflight", async () => {
  const { app, session, endpoint } = await setup();
  const planning = vi.spyOn(exportPlanning, "planSelectionExport").mockImplementation(
    (_session, _paths, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Preflight cancelled.")), {
          once: true,
        }),
      ),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  const client = httpRequest(`http://127.0.0.1:${address.port}${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  client.on("error", () => undefined);
  let closed = false;
  client.on("close", () => {
    closed = true;
  });
  client.end(JSON.stringify({ paths: ["clip.mp4"] }));
  try {
    await vi.waitFor(() => expect(planning).toHaveBeenCalledOnce());
    for (const operation of session.archiveOperations ?? []) operation.controller.abort();
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 1000 });
    expect(session.archiveOperations?.size).toBe(0);
  } finally {
    planning.mockRestore();
    client.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("exports an accepted Unicode selection after URL encoding expands its native POST body", async () => {
  const { app, session, root, endpoint } = await setup();
  const names = Array.from(
    { length: 1600 },
    (_, i) => `${"日".repeat(80)}${String(i).padStart(4, "0")}.txt`,
  );
  for (let i = 0; i < names.length; i += 64)
    await Promise.all(names.slice(i, i + 64).map((name) => writeFile(path.join(root, name), "x")));
  session.tree.children = names.map((name) => ({ name, path: name, type: "file", modifiedAt: 0 }));
  const selection = JSON.stringify({ paths: names, confirmed: true });
  expect(Buffer.byteLength(new URLSearchParams({ selection }).toString())).toBeGreaterThan(
    1024 ** 2,
  );
  await request(app).post(`${endpoint}/plan`).send({ paths: names }).expect(200);
  const response = await request(app)
    .post(endpoint)
    .type("form")
    .send({ selection })
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const zip = await unzipper.Open.buffer(response.body as Buffer);
  expect(zip.files.map((entry) => entry.path)).toEqual(names);
  expect((await zip.files[1599].buffer()).toString()).toBe("x");
}, 30_000);

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
