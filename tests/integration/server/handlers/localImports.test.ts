import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../../../server/application/jobs/jobManager.js";
import { createLocalImports } from "../../../../server/application/jobs/localImports.js";
import { registerLocalImportRoutes } from "../../../../server/handlers/localImports.js";
import type { SessionJob } from "../../../../server/domain/models.js";
import { PassThrough } from "node:stream";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import * as localUpload from "../../../../server/infrastructure/downloads/localUpload.js";

const disk = vi.hoisted(() => ({ available: 20 * 1024 ** 3 }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  statfsSync: () => ({ bsize: 1, bavail: disk.available }),
}));
const roots: string[] = [];
afterEach(async () => {
  disk.available = 20 * 1024 ** 3;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "local-import-"));
  roots.push(directory);
  const jobs = new Map<string, SessionJob>();
  const manager = createJobManager(jobs, vi.fn());
  const enqueue = vi.fn();
  const imports = createLocalImports({ directory, jobs, manager, registerJob: vi.fn(), enqueue });
  const app = express();
  app.use(express.json());
  registerLocalImportRoutes(app, imports, manager.sanitizeJob);
  const input = { id: randomUUID(), name: "日本語.txt", size: 5 };
  return { app, imports, jobs, manager, enqueue, input, directory };
}

it("streams exact bytes, hashes the source and makes repeated requests idempotent", async () => {
  const { app, jobs, enqueue, input } = await setup();
  const endpoint = `/api/local-imports/${input.id}/content`;
  await request(app).post("/api/local-imports").send(input).expect(201);
  await request(app)
    .put(endpoint)
    .type("application/octet-stream")
    .send(Buffer.from("hello"))
    .expect(200);
  const job = jobs.get(input.id) as SessionJob;
  expect(await readFile(job.zipPath, "utf8")).toBe("hello");
  expect(job.localSource?.sha256).toMatch(/^[a-f\d]{64}$/);
  expect(job.sourceKind).toBe("local");
  await request(app).post("/api/local-imports").send(input).expect(201);
  await request(app)
    .put(endpoint)
    .type("application/octet-stream")
    .send(Buffer.from("hello"))
    .expect(200);
  expect(jobs.size).toBe(1);
  expect(enqueue).toHaveBeenCalledTimes(1);
  await request(app)
    .post("/api/local-imports")
    .send({ ...input, name: "other.txt" })
    .expect(409);
});

it("rejects unsafe names and oversized metadata before creating a job or payload", async () => {
  const { app, jobs, input, directory } = await setup();
  for (const name of ["../escape.zip", "a\\b.txt", "a:b.txt", "CON.txt", "file.", ".", "a\0b"])
    await request(app)
      .post("/api/local-imports")
      .send({ ...input, name })
      .expect(400);
  await request(app)
    .post("/api/local-imports")
    .send({ ...input, size: 10 * 1024 ** 3 + 1 })
    .expect(400);
  expect(jobs.size).toBe(0);
  expect(await readdir(directory)).toEqual([]);
});

it("preserves a valid 255-byte filename when streaming the upload", async () => {
  const { app, input, jobs } = await setup();
  const name = `${"a".repeat(251)}.txt`;
  await request(app)
    .post("/api/local-imports")
    .send({ ...input, name })
    .expect(201);
  await request(app)
    .put(`/api/local-imports/${input.id}/content`)
    .type("application/octet-stream")
    .send(Buffer.from("hello"))
    .expect(200);
  const job = jobs.get(input.id) as SessionJob;
  expect(await readdir(path.dirname(job.zipPath))).toEqual([name]);
  expect(await readFile(job.zipPath, "utf8")).toBe("hello");
});

it("enforces admission and actual streamed size, cleans partial data, and retries the same job", async () => {
  const { app, jobs, input, enqueue } = await setup();
  await request(app).post("/api/local-imports").send(input).expect(201);
  const endpoint = `/api/local-imports/${input.id}/content`;
  disk.available = 64 * 1024 ** 2 + 4;
  await request(app)
    .put(endpoint)
    .type("application/octet-stream")
    .send(Buffer.from("hello"))
    .expect(507);
  disk.available += 100;
  await request(app)
    .put(endpoint)
    .type("application/octet-stream")
    .send(Buffer.from("too long"))
    .expect(400);
  await request(app)
    .put(endpoint)
    .type("application/octet-stream")
    .send(Buffer.from("tiny"))
    .expect(400);
  await request(app)
    .put(endpoint)
    .set("transfer-encoding", "chunked")
    .type("application/octet-stream")
    .send(Buffer.from("too long"))
    .expect(400);
  const job = jobs.get(input.id) as SessionJob;
  expect(await readdir(path.dirname(job.zipPath))).toEqual([]);
  expect(await readdir(job.workspaceDir)).not.toContain(".uploading");
  expect(enqueue).not.toHaveBeenCalled();
  await request(app)
    .put(endpoint)
    .type("application/octet-stream")
    .send(Buffer.from("hello"))
    .expect(200);
  expect(jobs.size).toBe(1);
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it("does not overwrite an owned source or follow a symlink at its upload path", async () => {
  const { app, jobs, input, directory } = await setup();
  await request(app).post("/api/local-imports").send(input).expect(201);
  const job = jobs.get(input.id) as SessionJob;
  const outside = path.join(directory, "outside.txt");
  await writeFile(outside, "untouched");
  await symlink(outside, path.join(job.workspaceDir, ".uploading"));
  await request(app)
    .put(`/api/local-imports/${input.id}/content`)
    .type("application/octet-stream")
    .send(Buffer.from("hello"))
    .expect(409);
  expect(await readFile(outside, "utf8")).toBe("untouched");
});

it("cancels a stalled stream, releases admission, and rejects simultaneous content writers", async () => {
  const { imports, input, jobs, enqueue } = await setup();
  const job = await imports.initialize(input);
  const stream = new PassThrough();
  const operation = imports.upload(input.id, stream, undefined, new AbortController().signal);
  const failure = operation.catch((error: unknown) => error);
  stream.write(Buffer.from("he"));
  await vi.waitFor(() => expect(job.downloadedBytes).toBe(2));
  await expect(
    imports.upload(input.id, new PassThrough(), undefined, new AbortController().signal),
  ).rejects.toMatchObject({ status: 409 });
  job.abortController?.abort();
  expect(await failure).toBeInstanceOf(Error);
  expect(job.status).toBe("cancelled");
  expect(await readdir(path.dirname(job.zipPath))).toEqual([]);
  expect(await readdir(job.workspaceDir)).not.toContain(".uploading");
  expect(enqueue).not.toHaveBeenCalled();
  const retried = new PassThrough();
  const done = imports.upload(input.id, retried, "5", new AbortController().signal);
  retried.end("hello");
  await done;
  expect(jobs.size).toBe(1);
  expect(enqueue).toHaveBeenCalledTimes(1);
});

it("cleans a disconnected HTTP upload and accepts a retry without another job", async () => {
  const { app, input, jobs } = await setup();
  await request(app).post("/api/local-imports").send(input).expect(201);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  try {
    const upload = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      method: "PUT",
      path: `/api/local-imports/${input.id}/content`,
      headers: { "content-type": "application/octet-stream", "content-length": 5 },
    });
    upload.on("error", () => undefined);
    upload.write("he");
    const job = jobs.get(input.id) as SessionJob;
    await vi.waitFor(() => expect(job.downloadedBytes).toBe(2));
    upload.destroy();
    await vi.waitFor(() => expect(job.uploadOperation).toBeUndefined());
    expect(await readdir(path.dirname(job.zipPath))).toEqual([]);
    expect(await readdir(job.workspaceDir)).not.toContain(".uploading");
    await request(app)
      .put(`/api/local-imports/${input.id}/content`)
      .type("application/octet-stream")
      .send(Buffer.from("hello"))
      .expect(200);
    expect(jobs.size).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("limits active streams without starting another writer", async () => {
  const { imports, input, jobs } = await setup();
  const second = { ...input, id: randomUUID() };
  const third = { ...input, id: randomUUID() };
  await Promise.all([
    imports.initialize(input),
    imports.initialize(second),
    imports.initialize(third),
  ]);
  const streams = [new PassThrough(), new PassThrough()];
  const active = [
    imports.upload(input.id, streams[0], "5", new AbortController().signal),
    imports.upload(second.id, streams[1], "5", new AbortController().signal),
  ];
  const settled = Promise.allSettled(active);
  await expect(
    imports.upload(third.id, new PassThrough(), "5", new AbortController().signal),
  ).rejects.toMatchObject({ status: 429 });
  for (const job of jobs.values()) job.abortController?.abort();
  await settled;
});

it("reserves combined disk use and keeps an expired import available for the same retry", async () => {
  const { imports, input, manager, jobs } = await setup();
  const job = await imports.initialize(input);
  const second = await imports.initialize({ ...input, id: randomUUID() });
  disk.available = 64 * 1024 ** 2 + 9;
  const stream = new PassThrough();
  const first = imports.upload(job.id, stream, "5", new AbortController().signal);
  const settled = first.catch((error: unknown) => error);
  stream.write("he");
  await vi.waitFor(() => expect(job.downloadedBytes).toBe(2));
  await expect(
    imports.upload(second.id, new PassThrough(), "5", new AbortController().signal),
  ).rejects.toThrow("storage");
  job.abortController?.abort();
  await settled;
  await manager.cleanupJob(job.id, "expired");
  expect(jobs.get(job.id)).toBe(job);
  expect(job.status).toBe("cancelled");
  expect(await readdir(path.dirname(job.zipPath))).toEqual([]);
  disk.available += 100;
  const retry = new PassThrough();
  const uploaded = imports.upload(job.id, retry, "5", new AbortController().signal);
  retry.end("hello");
  await uploaded;
  expect(await readFile(job.zipPath, "utf8")).toBe("hello");
});

it("rejects content for unknown jobs, wrong media types and encoded bodies", async () => {
  const { app, input } = await setup();
  const endpoint = `/api/local-imports/${input.id}/content`;
  await request(app).put(endpoint).type("application/octet-stream").send("hello").expect(404);
  await request(app).post("/api/local-imports").send(input).expect(201);
  await request(app).put(endpoint).type("text/plain").send("hello").expect(415);
  await request(app)
    .put(endpoint)
    .type("application/octet-stream")
    .set("content-encoding", "gzip")
    .send("hello")
    .expect(415);
});

it("does not register or retain a job when its initial source directory is not owned", async () => {
  const { app, input, jobs, directory } = await setup();
  const outside = path.join(directory, "outside");
  const workspace = path.join(directory, input.id);
  await mkdir(outside);
  await mkdir(workspace);
  await symlink(outside, path.join(workspace, "source"), "junction");
  await request(app).post("/api/local-imports").send(input).expect(409);
  expect(jobs.size).toBe(0);
  expect(await readdir(outside)).toEqual([]);
});

it("rejects a retry while expiry cleanup owns its files, then accepts it after cleanup drains", async () => {
  const { imports, input, manager } = await setup();
  const job = await imports.initialize(input);
  const cleanup = localUpload.cleanupIncompleteLocalSource;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = vi
    .spyOn(localUpload, "cleanupIncompleteLocalSource")
    .mockImplementation(async (value) => {
      await gate;
      await cleanup(value);
    });
  const expired = manager.cleanupJob(job.id, "expired");
  const retry = new PassThrough();
  retry.end("hello");
  try {
    await vi.waitFor(() => expect(held).toHaveBeenCalled());
    await expect(
      imports.upload(job.id, retry, "5", new AbortController().signal),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    release();
    await expired;
    held.mockRestore();
  }
  const finished = new PassThrough();
  finished.end("hello");
  await imports.upload(job.id, finished, "5", new AbortController().signal);
  expect(await readFile(job.zipPath, "utf8")).toBe("hello");
});
