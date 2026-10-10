import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionJob } from "../../domain/models.js";
import type { TorrentAdapter } from "../torrents/torrentDownloader.js";
import { createJobManager } from "./jobManager.js";
import { createRetainedTorrentStore } from "../../repositories/retainedTorrents.js";

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
  it.each(["indexing", "ready"])(
    "keeps a transient persistence failure at %s in a controlled error state",
    async (phase) => {
      const workspace = await mkdtemp(
        path.join(os.tmpdir(), "torrent-lifecycle-full-"),
      );
      workspaces.push(workspace);
      const store = createRetainedTorrentStore(workspace);
      try {
        const manager = createJobManager(new Map(), vi.fn(), store);
        const job = manager.createJob("magnet:?xt=urn:btih:" + "a".repeat(40));
        job.torrentFiles = [
          {
            id: "0",
            path: "fixture.txt",
            size: 4,
            selected: true,
            complete: true,
            downloadedBytes: 4,
          },
        ];
        const original = store.save.bind(store);
        let failed = false;
        vi.spyOn(store, "save").mockImplementation((changed) => {
          if (!failed && changed.phase === phase) {
            failed = true;
            throw new Error("SQLITE_FULL");
          }
          original(changed);
        });
        const processJob = createProcessSessionJob({
          sessionStore: new Map(),
          torrentAdapter: {
            download: vi.fn().mockResolvedValue({ files: ["fixture.txt"] }),
            close: vi.fn(),
          },
          emitJob: manager.emitJob,
          closeJob: manager.closeJob,
          download: vi.fn(),
          detectEncryption: vi.fn(),
          extractWith7zip: vi.fn(),
          listExtractedEntries: vi.fn().mockResolvedValue([
            {
              name: "fixture.txt",
              type: "file",
              relativePath: "fixture.txt",
              size: 4,
              modifiedAt: 1,
            },
          ]),
          logEvent: vi.fn(),
        });
        await processJob(job);
        expect(failed).toBe(true);
        expect(job.status).toBe("error");
        expect(job.error).toContain("SQLITE_FULL");
        expect(store.read()[0].job.status).toBe("error");
      } finally {
        store.close();
      }
    },
  );
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
      torrentAdapter: { download: vi.fn(), close: vi.fn() },
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

  it("treats a requested cancellation as a normal terminal state", async () => {
    const logEvent = vi.fn();
    const manager = createJobManager(new Map(), vi.fn());
    const job = manager.createJob("https://example.com/archive.zip");
    mocks.downloadSessionSource.mockRejectedValue(
      Object.assign(new Error("Cancelled"), { name: "AbortError" }),
    );
    const processJob = createProcessSessionJob({
      sessionStore: new Map(),
      torrentAdapter: { download: vi.fn(), close: vi.fn() },
      emitJob: manager.emitJob,
      closeJob: manager.closeJob,
      download: vi.fn(),
      detectEncryption: vi.fn(),
      extractWith7zip: vi.fn(),
      listExtractedEntries: vi.fn(),
      logEvent,
    });

    await processJob(job);

    expect(job.status).toBe("cancelled");
    expect(logEvent).not.toHaveBeenCalledWith(
      "error",
      "session.create.failed",
      expect.anything(),
    );
  });

  it("builds a completed session directly from deterministic torrent files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "torrent-job-"));
    workspaces.push(workspace);
    const sessionStore = new Map<string, Session>();
    const manager = createJobManager(new Map(), vi.fn());
    const job = manager.createJob(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=fixture",
    );
    job.workspaceDir = workspace;
    const torrentFiles = [
      {
        id: "0",
        path: "album/image.jpg",
        size: 100,
        selected: false,
        downloadedBytes: 0,
        complete: false,
      },
    ];
    const download = vi.fn<TorrentAdapter["download"]>(
      ({ onMetadata, onProgress }) => {
        onMetadata({
          files: torrentFiles,
          length: 100,
          name: "fixture",
        });
        onProgress({
          files: torrentFiles.map((file) => ({
            ...file,
            selected: true,
            complete: true,
            downloadedBytes: file.size,
          })),
          downloadedBytes: 100,
          downloadSpeedBytesPerSec: 50,
          peerCount: 1,
          progress: 1,
          uploadedBytes: 0,
          uploadSpeedBytesPerSec: 0,
        });
        return Promise.resolve({ files: ["album/image.jpg"] });
      },
    );
    const processJob = createProcessSessionJob({
      sessionStore,
      emitJob: manager.emitJob,
      closeJob: manager.closeJob,
      download: vi.fn(),
      detectEncryption: vi.fn(),
      extractWith7zip: vi.fn(),
      listExtractedEntries: vi.fn(() =>
        Promise.resolve([
          {
            type: "file" as const,
            relativePath: "album/image.jpg",
            size: 100,
            modifiedAt: 1,
          },
          {
            type: "file" as const,
            relativePath: "album/unselected.txt",
            size: 20,
            modifiedAt: 1,
          },
        ]),
      ),
      logEvent: vi.fn(),
      torrentAdapter: { download, close: vi.fn() },
    });

    await processJob(job);

    expect(job.status).toBe("awaiting_selection");
    expect(sessionStore.size).toBe(0);
    job.torrentFiles = torrentFiles.map((file) => ({
      ...file,
      selected: true,
    }));
    await processJob(job);

    expect(download).toHaveBeenCalledTimes(2);
    expect(job.status).toBe("ready");
    expect(sessionStore.size).toBe(1);
    expect(sessionStore.get(job.sessionId)?.stats.fileCount).toBe(1);
    expect(sessionStore.get(job.sessionId)?.firstFilePath).toBe(
      "album/image.jpg",
    );
  });
});
