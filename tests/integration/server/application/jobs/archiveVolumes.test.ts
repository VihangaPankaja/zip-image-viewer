import { expect, test, vi } from "vite-plus/test";
import { readFile, readdir, mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { createRetainedTorrentStore } from "../../../../../server/repositories/retainedTorrents.js";
import { restoreHttpDownloads } from "../../../../../server/application/downloads/restoreHttpDownloads.js";
import type { SessionJob } from "../../../../../server/domain/models.js";
import { startArchiveVolumesApp } from "../../../../fixtures/archiveVolumesApp.js";

test("startup pauses interrupted multipart downloads without starting network work", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "volume-restore-"));
  const store = createRetainedTorrentStore(root);
  try {
    const manager = createJobManager(new Map(), vi.fn(), store);
    const job = manager.createJob("https://example.com/book.7z.001");
    await mkdir(job.workspaceDir, { recursive: true });
    manager.emitJob(job, { status: "downloading", phase: "downloading" });
    const jobs = new Map<string, SessionJob>();
    const process = vi.fn(async () => {});
    await restoreHttpDownloads(store, jobs, process, vi.fn());
    expect(process).not.toHaveBeenCalled();
    expect(jobs.get(job.id)).toMatchObject({ status: "paused", canResume: true });
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("encrypted multipart HTTP retries only the password and asks again after restart", async () => {
  const password = "multipart-private-$()";
  const app = await startArchiveVolumesApp(undefined, false, password);
  try {
    const id = app.items[0].id;
    const status = async () => (await app.client.jobs.list()).items[0].status;
    await expect.poll(status, { timeout: 20_000 }).toBe("awaiting_password");
    await app.client.jobs.password({ id, password: "wrong" });
    await expect.poll(status, { timeout: 20_000 }).toBe("awaiting_password");
    await app.client.jobs.password({ id, password });
    await expect.poll(status, { timeout: 20_000 }).toBe("ready");
    expect([...app.requests.values()]).toEqual(app.names.map(() => 1));
    expect(app.logs()).not.toContain(password);
    await app.restart();
    await expect.poll(status, { timeout: 20_000 }).toBe("awaiting_password");
  } finally {
    await app.close();
  }
}, 60_000);

test("HTTP batch groups reversed volumes and reuses verified parts across restart and missing-volume recovery", async () => {
  const app = await startArchiveVolumesApp();
  try {
    expect(app.items).toHaveLength(1);
    const id = app.items[0].id;
    await expect
      .poll(async () => (await app.client.jobs.list()).items[0].status, { timeout: 20_000 })
      .toBe("awaiting_volumes");
    const output = path.join(app.directory, "sessions", id, "extracted");
    expect(await readdir(output)).toEqual([]);
    await app.restart();
    await expect
      .poll(async () => (await app.client.jobs.list()).items[0].status, { timeout: 20_000 })
      .toBe("awaiting_volumes");
    await expect(
      app.client.jobs.volumes({ id, urls: ["https://example.com/unrelated.7z.003"] }),
    ).rejects.toThrow(/same archive/i);
    await app.client.jobs.volumes({ id, urls: [app.url(app.names[app.names.length - 1])] });
    await expect
      .poll(async () => (await app.client.jobs.list()).items[0].status, { timeout: 20_000 })
      .toBe("ready");
    expect((await readFile(path.join(output, "日本語.txt"))).length).toBe(2048);
    expect([...app.requests.values()]).toEqual(app.names.map(() => 1));
  } finally {
    await app.close();
  }
}, 60_000);
