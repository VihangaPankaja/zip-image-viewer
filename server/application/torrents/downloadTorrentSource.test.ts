import { describe, expect, it, vi } from "vitest";
import type { SessionJob } from "../../domain/models.js";
import { createJobManager } from "../jobs/jobManager.js";
import { downloadOptionsToSettings } from "../downloads/downloadOptions.js";
import type { TorrentAdapter } from "./torrentDownloader.js";
import { downloadTorrentSource } from "./downloadTorrentSource.js";

function setup() {
  const emitJob = vi.fn((job: SessionJob, patch: Partial<SessionJob>) => {
    Object.assign(job, patch);
  });
  const job = createJobManager(new Map(), vi.fn()).createJob(
    "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
  );
  job.abortController = new AbortController();
  const settings = downloadOptionsToSettings(job.downloadOptions);
  return { emitJob, job, settings };
}

describe("downloadTorrentSource", () => {
  it("requires confirmation after metadata resolves for oversized torrents", async () => {
    const { emitJob, job, settings } = setup();
    const adapter: TorrentAdapter = {
      close: vi.fn(),
      download: vi.fn<TorrentAdapter["download"]>(({ onMetadata }) => {
        onMetadata({
          files: ["large.bin"],
          length: 2 * 1024 ** 3,
          name: "large",
        });
        return Promise.resolve({ files: [] });
      }),
    };

    await expect(
      downloadTorrentSource(
        job,
        settings,
        { confirmOversize: false, downloadDir: "torrent" },
        { adapter, emitJob },
      ),
    ).resolves.toBe("paused");
    expect(job.status).toBe("awaiting_confirmation");
  });

  it("reports peers, progress, no-peer stalls, retry, and indexing", async () => {
    const { emitJob, job, settings } = setup();
    const download = vi
      .fn<TorrentAdapter["download"]>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockImplementationOnce(({ onMetadata, onNoPeers, onProgress }) => {
        onMetadata({ files: ["image.jpg"], length: 100, name: "fixture" });
        onNoPeers();
        onProgress({
          downloadedBytes: 50,
          downloadSpeedBytesPerSec: 20,
          peerCount: 2,
          progress: 0.5,
          uploadedBytes: 0,
          uploadSpeedBytesPerSec: 0,
        });
        return Promise.resolve({ files: ["image.jpg"] });
      });

    await expect(
      downloadTorrentSource(
        job,
        settings,
        { confirmOversize: true, downloadDir: "torrent" },
        { adapter: { close: vi.fn(), download }, emitJob },
      ),
    ).resolves.toBe("complete");
    expect(download).toHaveBeenCalledTimes(2);
    expect(job).toMatchObject({
      peerCount: 2,
      verifiedBytes: 50,
      phase: "indexing",
      retryCount: 1,
    });
  });

  it("tells the adapter to retain pieces only for a requested pause", async () => {
    const { emitJob, job, settings } = setup();
    job.pauseRequested = true;
    const download = vi.fn<TorrentAdapter["download"]>((input) => {
      expect(input.retainStoreOnAbort()).toBe(true);
      return Promise.reject(
        Object.assign(new Error("Paused"), { name: "AbortError" }),
      );
    });

    await expect(
      downloadTorrentSource(
        job,
        settings,
        { confirmOversize: true, downloadDir: "torrent" },
        { adapter: { close: vi.fn(), download }, emitJob },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(download).toHaveBeenCalledOnce();
  });
});
