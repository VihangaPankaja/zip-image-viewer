import express from "express";
import request from "supertest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createJobManager } from "../application/jobs/jobManager.js";
import { registerTorrentVideoRoutes } from "./torrentVideoRoutes.js";
import type { SessionJob } from "../domain/models.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "indexing-video-"));
  directories.push(directory);
  const jobs = new Map<string, SessionJob>();
  const job = createJobManager(jobs, vi.fn()).createJob(
    "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
    {},
  );
  job.workspaceDir = directory;
  job.status = "downloading";
  job.phase = "indexing";
  const bytes = Buffer.alloc(56);
  for (const [offset, size, type] of [
    [0, 8, "ftyp"],
    [8, 8, "moov"],
    [16, 40, "mdat"],
  ] as const) {
    bytes.writeUInt32BE(size, offset);
    bytes.write(type, offset + 4);
  }
  job.torrentFiles = [
    {
      id: "0",
      path: "film.mp4",
      size: bytes.length,
      selected: true,
      complete: true,
      downloadedBytes: bytes.length,
    },
  ];
  await mkdir(path.join(directory, "torrent"));
  await writeFile(path.join(directory, "torrent", "film.mp4"), bytes);
  const openVideoFile = vi.fn(() => {
    throw new Error("Completed reads must not reopen the live torrent");
  });
  const app = express();
  registerTorrentVideoRoutes(app, jobs, {
    openVideoFile,
    download: vi.fn(),
    close: vi.fn(),
  });
  return {
    app,
    job,
    directory,
    bytes,
    openVideoFile,
    url: `/api/session-jobs/${job.id}/video/stream?fileId=0`,
  };
}

it("keeps verified completed-video seeks working throughout indexing and ready", async () => {
  const { app, job, url, openVideoFile } = await fixture();
  for (const status of ["downloading", "ready"] as const) {
    job.status = status;
    const response = await request(app).get(url).set("Range", "bytes=0-0");
    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 0-0/56");
    expect(response.headers["content-length"]).toBe("1");
  }
  expect(openVideoFile).not.toHaveBeenCalled();
});

it("does not expose incomplete, skipped, missing or escaped retained files", async () => {
  const { app, job, directory, bytes, url } = await fixture();
  job.torrentFiles[0].complete = false;
  expect((await request(app).get(url)).status).toBe(409);
  job.torrentFiles[0].complete = true;
  job.torrentFiles[0].selected = false;
  expect((await request(app).get(url)).status).toBe(409);
  job.torrentFiles[0].selected = true;
  job.torrentFiles[0].path = "../outside.mp4";
  await writeFile(path.join(directory, "outside.mp4"), bytes);
  expect((await request(app).get(url)).status).toBe(409);
  job.torrentFiles[0].path = "missing.mp4";
  expect((await request(app).get(url)).status).toBe(409);
  job.torrentFiles[0].path = "film.mp4";
  job.torrentFiles[0].size += 1;
  expect((await request(app).get(url)).status).toBe(409);
});
