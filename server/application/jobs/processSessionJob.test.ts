import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionJob } from "../../domain/models.js";
import { createJobManager } from "./jobManager.js";

const mocks = vi.hoisted(() => ({
  downloadSessionSource: vi.fn(),
}));

vi.mock("./downloadSessionSource.js", () => ({
  downloadSessionSource: mocks.downloadSessionSource,
}));

import { createProcessSessionJob } from "./processSessionJob.js";

const workspaces: string[] = [];

afterEach(async () => {
  mocks.downloadSessionSource.mockReset();
  await Promise.all(
    workspaces
      .splice(0)
      .map((workspace) => rm(workspace, { force: true, recursive: true })),
  );
});

describe("createProcessSessionJob", () => {
  it("keeps resumable partial files when a pause aborts the download", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "queue-pause-"));
    workspaces.push(workspace);
    const extractDir = path.join(workspace, "extracted");
    await mkdir(extractDir);
    const manager = createJobManager(new Map(), vi.fn());
    const job = manager.createJob("https://example.com/archive.zip");
    Object.assign(job, {
      workspaceDir: workspace,
      zipPath: path.join(workspace, "archive.zip"),
      extractDir,
      canResume: true,
      canPause: true,
      pauseRequested: false,
    });
    mocks.downloadSessionSource.mockImplementation(
      (downloadJob: SessionJob) => {
        downloadJob.pauseRequested = true;
        return Promise.reject(
          Object.assign(new Error("Paused"), { name: "AbortError" }),
        );
      },
    );
    const processJob = createProcessSessionJob({
      sessionStore: new Map(),
      emitJob: manager.emitJob,
      closeJob: manager.closeJob,
      download: vi.fn(),
      detectEncryption: vi.fn(),
      extractWith7zip: vi.fn(),
      listExtractedEntries: vi.fn(),
      logEvent: vi.fn(),
    });

    await processJob(job);

    expect(job.status).toBe("paused");
    expect(job.workspaceDir).toBe(workspace);
    await expect(stat(workspace)).resolves.toMatchObject({});
  });
});
