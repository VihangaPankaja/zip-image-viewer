import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../server/application/jobs/jobManager.js";
import { createRetainedTorrentStore } from "../../server/repositories/retainedTorrents.js";
import { restoreHttpDownloads } from "../../server/application/downloads/restoreHttpDownloads.js";
import { createSessionJobQueue } from "../../server/application/jobs/sessionJobQueue.js";
import type { SessionJob } from "../../server/domain/models.js";

it.each(["paused", "awaiting_confirmation", "error", "corrupt", "suffix"])(
  "restores HTTP lifecycle state and reconciles owned checkpoint files (%s)",
  async (scenario) => {
    const directory = await mkdtemp(path.join(tmpdir(), "http-state-"));
    let store = createRetainedTorrentStore(directory);
    const jobs = new Map<string, SessionJob>();
    const manager = createJobManager(jobs, vi.fn(), store);
    try {
      const job = manager.createJob("https://example.com/notes.txt");
      await mkdir(job.workspaceDir);
      const source = path.join(job.workspaceDir, "source.txt");
      await writeFile(
        source,
        scenario === "corrupt" ? "bad" : scenario === "suffix" ? "good-tail" : "good",
      );
      const complete = scenario === "error";
      manager.emitJob(job, {
        status:
          scenario === "awaiting_confirmation"
            ? "awaiting_confirmation"
            : complete
              ? "error"
              : "paused",
        phase: scenario === "awaiting_confirmation" ? "confirm" : complete ? "error" : "paused",
        requiresConfirmation: scenario === "awaiting_confirmation",
        reportedSize: scenario === "awaiting_confirmation" ? 128 : 0,
        httpDownload: {
          originalUrl: job.url,
          resolvedUrl: job.url,
          size: complete ? 4 : 8,
          validator: '"v1"',
          files: [
            {
              index: -1,
              start: 0,
              end: complete ? 3 : 7,
              bytes: 4,
              sha256: createHash("sha256").update("good").digest("hex"),
            },
          ],
          completedSha256: complete ? createHash("sha256").update("good").digest("hex") : "",
        },
      });
      await manager.cleanupJob(job.id, "expired");
      await manager.cleanupJob(job.id, "shutdown");
      expect(jobs.has(job.id)).toBe(true);
      store.close();
      store = createRetainedTorrentStore(directory);
      jobs.clear();
      await restoreHttpDownloads(store, jobs, vi.fn(), vi.fn());
      const restored = jobs.get(job.id);
      expect(restored).toMatchObject({
        status: job.status,
        requiresConfirmation: job.requiresConfirmation,
        downloadedBytes: scenario === "corrupt" ? 0 : 4,
        reportedSize: scenario === "awaiting_confirmation" ? 128 : complete ? 4 : 8,
      });
      if (complete) expect(restored?.httpDownload?.completedSha256).toBeTruthy();
      if (scenario === "corrupt")
        await expect(stat(source)).rejects.toMatchObject({ code: "ENOENT" });
      else expect(await readFile(source, "utf8")).toBe("good");
      if (scenario === "awaiting_confirmation" && restored) {
        const queue = createSessionJobQueue({
          initialJobs: [restored],
          pendingSessionJobs: [],
          maxActiveSessionJobs: 1,
          emitJob: createJobManager(jobs, vi.fn(), store).emitJob,
          getActiveSessionJobCount: () => 1,
          incrementActiveSessionJobCount: vi.fn(),
          decrementActiveSessionJobCount: vi.fn(),
          processSessionJob: vi.fn(),
          logEvent: vi.fn(),
        });
        queue.confirmSessionJob(job.id);
        store.close();
        store = createRetainedTorrentStore(directory);
        await restoreHttpDownloads(store, jobs, vi.fn(), vi.fn());
        expect(jobs.get(job.id)).toMatchObject({
          status: "paused",
          requiresConfirmation: false,
          oversizeConfirmed: true,
        });
      }
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("rejects a replaced workspace junction before startup reconciliation or explicit deletion touches its target", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "http-owner-"));
  const store = createRetainedTorrentStore(path.join(directory, "sessions"));
  const jobs = new Map<string, SessionJob>();
  const manager = createJobManager(jobs, vi.fn(), store);
  const job = manager.createJob("https://example.com/file.bin");
  const other = path.join(directory, "other-owner");
  try {
    await mkdir(other);
    await writeFile(path.join(other, "source.bin"), "keep me");
    await symlink(other, job.workspaceDir, process.platform === "win32" ? "junction" : "dir");
    await restoreHttpDownloads(store, jobs, vi.fn(), vi.fn());
    expect(jobs.get(job.id)).toMatchObject({ status: "error", sessionId: "" });
    await expect(manager.cleanupJob(job.id, "removed")).rejects.toThrow("owned directory");
    expect(await readFile(path.join(other, "source.bin"), "utf8")).toBe("keep me");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
