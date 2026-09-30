import { describe, expect, it, vi } from "vitest";
import type { SessionJob } from "../../domain/models.js";
import { createJobManager } from "../jobs/jobManager.js";
import { downloadOptionsToSettings } from "../downloads/downloadOptions.js";
import type { TorrentAdapter } from "./torrentDownloader.js";
import { downloadTorrentSource } from "./downloadTorrentSource.js";

function file(path = "image.jpg", size = 100) {
  return {
    id: "0",
    path,
    size,
    selected: true,
    downloadedBytes: 0,
    complete: false,
  };
}

function setup() {
  const emitJob = vi.fn((job: SessionJob, patch: Partial<SessionJob>) => {
    Object.assign(job, patch);
  });
  const job = createJobManager(new Map(), vi.fn()).createJob(
    "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
  );
  job.torrentFiles = [file()];
  job.abortController = new AbortController();
  const settings = downloadOptionsToSettings(job.downloadOptions);
  return { emitJob, job, settings };
}

describe("downloadTorrentSource", () => {
  it("stops after metadata until the user selects files", async () => {
    const { emitJob, job, settings } = setup();
    job.torrentFiles = [];
    const download = vi.fn<TorrentAdapter["download"]>(({ onMetadata }) => {
      onMetadata({
        files: [{ ...file(), selected: false }],
        length: 100,
        name: "fixture",
      });
      return Promise.resolve({ files: [] });
    });
    await expect(
      downloadTorrentSource(
        job,
        settings,
        { confirmOversize: false, downloadDir: "torrent" },
        { adapter: { close: vi.fn(), download }, emitJob },
      ),
    ).resolves.toBe("paused");
    expect(job).toMatchObject({
      status: "awaiting_selection",
      phase: "selecting",
      torrentFiles: [{ id: "0", selected: false }],
    });
    expect(download).toHaveBeenCalledOnce();
  });

  it("requires confirmation after metadata resolves for oversized torrents", async () => {
    const { emitJob, job, settings } = setup();
    job.torrentFiles = [file("large.bin", 2 * 1024 ** 3)];
    const adapter: TorrentAdapter = {
      close: vi.fn(),
      download: vi.fn<TorrentAdapter["download"]>(({ onMetadata }) => {
        onMetadata({
          files: [file("large.bin", 2 * 1024 ** 3)],
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

  it("confirms only the selected bytes and preserves the cached metadata", async () => {
    const { emitJob, job, settings } = setup();
    const torrentFile = new Uint8Array([1, 2]);
    job.torrentMetadata = torrentFile;
    job.url = "https://example.com/fixture.torrent";
    const download = vi.fn<TorrentAdapter["download"]>(
      ({ source, onMetadata }) => {
        expect(source).toBe(torrentFile);
        expect(
          onMetadata({
            files: [
              file(),
              { ...file("large.bin", 2 * 1024 ** 3), id: "1", selected: false },
            ],
            length: 2 * 1024 ** 3 + 100,
            name: "fixture",
            torrentFile,
          }),
        ).toEqual(["0"]);
        return Promise.resolve({ files: ["image.jpg"] });
      },
    );
    await expect(
      downloadTorrentSource(
        job,
        settings,
        { confirmOversize: false, downloadDir: "torrent" },
        { adapter: { close: vi.fn(), download }, emitJob },
      ),
    ).resolves.toBe("complete");
    expect(job.reportedSize).toBe(100);
  });

  it("rejects a selection if metadata no longer matches its files", async () => {
    const { emitJob, job, settings } = setup();
    settings.maxRetries = 0;
    const download = vi.fn<TorrentAdapter["download"]>(({ onMetadata }) => {
      onMetadata({
        files: [file("changed.jpg")],
        length: 100,
        name: "changed",
      });
      return Promise.resolve({ files: [] });
    });
    await expect(
      downloadTorrentSource(
        job,
        settings,
        { confirmOversize: false, downloadDir: "torrent" },
        { adapter: { close: vi.fn(), download }, emitJob },
      ),
    ).rejects.toThrow("metadata changed");
  });

  it("reports peers, progress, no-peer stalls, retry, and indexing", async () => {
    const { emitJob, job, settings } = setup();
    const download = vi
      .fn<TorrentAdapter["download"]>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockImplementationOnce(({ onMetadata, onNoPeers, onProgress }) => {
        onMetadata({ files: [file()], length: 100, name: "fixture" });
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

it("clears a connected-peer stall when data arrives before piece verification", async () => {
  const { emitJob, job, settings } = setup();
  const now = vi.spyOn(Date, "now").mockReturnValue(0);
  job.torrentFiles[0].priority = "high";
  const download = vi.fn<TorrentAdapter["download"]>(
    ({ jobId, priorities, onMetadata, onProgress }) => {
      expect(jobId).toBe(job.id);
      expect(priorities).toEqual({ "0": "high" });
      onMetadata({ files: [file()], length: 100, name: "fixture" });
      const progress = {
        downloadedBytes: 0,
        downloadSpeedBytesPerSec: 0,
        peerCount: 1,
        progress: 0,
        uploadedBytes: 0,
        uploadSpeedBytesPerSec: 0,
      };
      now.mockReturnValue(16_000);
      onProgress(progress);
      expect(job.isStalled).toBe(true);
      expect(job.message).toContain("Waiting for availability");
      now.mockReturnValue(32_000);
      onProgress({ ...progress, downloadSpeedBytesPerSec: 1024 });
      expect(job.isStalled).toBe(false);
      expect(job.verifiedBytes).toBe(0);
      now.mockReturnValue(48_000);
      onProgress({ ...progress, downloadSpeedBytesPerSec: 1024 });
      expect(job.isStalled).toBe(false);
      onProgress({ ...progress, downloadedBytes: 50, progress: 0.5 });
      expect(job.isStalled).toBe(false);
      return Promise.resolve({ files: ["image.jpg"] });
    },
  );
  try {
    await downloadTorrentSource(
      job,
      settings,
      { confirmOversize: true, downloadDir: "torrent" },
      { adapter: { close: vi.fn(), download }, emitJob },
    );
  } finally {
    now.mockRestore();
  }
});
