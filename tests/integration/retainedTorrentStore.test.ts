import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createJobManager } from "../../server/application/jobs/jobManager.js";
import { createRetainedTorrentStore } from "../../server/repositories/retainedTorrents.js";
import { createSessionJobQueue } from "../../server/application/jobs/sessionJobQueue.js";

it("commits torrent metadata and state together and removes only the requested record", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "retained-torrents-"));
  let store = createRetainedTorrentStore(directory);
  try {
    const manager = createJobManager(new Map(), vi.fn());
    const job = manager.createJob(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    );
    job.torrentMetadata = new Uint8Array([1, 2, 3]);
    job.status = "paused";
    store.save(job);
    const other = manager.createJob(job.url);
    store.save(other);
    store.save(job);
    store.close();
    store = createRetainedTorrentStore(directory);
    expect(store.read().map(({ job: saved }) => saved.id)).toEqual([
      job.id,
      other.id,
    ]);
    expect(store.read()[0].metadata).toEqual(new Uint8Array([1, 2, 3]));
    expect(store.read()[0].job.status).toBe("paused");
    const queue = createSessionJobQueue({
      initialJobs: [job, other],
      pendingSessionJobs: [],
      maxActiveSessionJobs: 1,
      getActiveSessionJobCount: () => 0,
      incrementActiveSessionJobCount: vi.fn(),
      decrementActiveSessionJobCount: vi.fn(),
      processSessionJob: vi.fn(),
      emitJob: (changed) => store.save(changed),
      logEvent: vi.fn(),
    });
    queue.reorderSessionJobs([other.id, job.id]);
    store.close();
    store = createRetainedTorrentStore(directory);
    expect(store.read().map(({ job: saved }) => saved.id)).toEqual([
      other.id,
      job.id,
    ]);
    store.remove(job.id);
    expect(store.read().map(({ job: saved }) => saved.id)).toEqual([other.id]);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
