import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebTorrent, { type Torrent } from "webtorrent";
import { expect, it, vi } from "vitest";
import { createJobManager } from "../jobs/jobManager.js";
import { createRetainedTorrentStore } from "../../repositories/retainedTorrents.js";
import {
  createWebTorrentAdapter,
  type TorrentProgress,
} from "./torrentDownloader.js";

it("reviews without transfer and completes one selected file from a real three-file torrent", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "torrent-selection-"));
  const seedDir = path.join(workspace, "seed");
  await mkdir(seedDir);
  const contents = [
    randomBytes(100_003),
    randomBytes(100_007),
    randomBytes(100_009),
  ];
  await Promise.all(
    contents.map((bytes, i) =>
      writeFile(path.join(seedDir, `${i}.bin`), bytes),
    ),
  );
  const seed = new WebTorrent({
    dht: false,
    tracker: false,
    lsd: false,
    utp: false,
    natUpnp: false,
    natPmp: false,
  });
  const adapter = createWebTorrentAdapter();
  const add = vi.spyOn(WebTorrent.prototype, "add");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const seedOptions = { announce: [], pieceLength: 16_384 };
    const torrent = await new Promise<Torrent>((resolve) =>
      seed.seed(seedDir, seedOptions, resolve),
    );
    const requestedPieces: number[] = [];
    torrent.on("wire", (wire) =>
      wire.on("request", (index) => requestedPieces.push(index)),
    );
    const address = seed.address();
    if (!address || typeof address === "string")
      throw new Error("Local seeder has no TCP port");
    const source = `magnet:?xt=urn:btih:${torrent.infoHash}&x.pe=127.0.0.1:${String(address.port)}`;
    const progress: TorrentProgress[] = [];
    const input = {
      source,
      downloadDir: path.join(workspace, "download"),
      signal: controller.signal,
      retainStoreOnAbort: () => false,
      onNoPeers: () => undefined,
      onProgress: (value: TorrentProgress) => {
        progress.push(value);
      },
    };
    await expect(
      adapter.download({
        ...input,
        onMetadata: ({ files }) => {
          expect(files.map((file) => file.selected)).toEqual([
            false,
            false,
            false,
          ]);
          expect(files.map((file) => file.size)).toEqual(
            contents.map((bytes) => bytes.length),
          );
          throw new Error("Review files first");
        },
      }),
    ).rejects.toThrow("Review files first");
    expect(requestedPieces).toHaveLength(0);
    expect(progress).toHaveLength(0);
    let duplicate: Promise<unknown> | undefined;
    const duplicateMetadata = vi.fn(() => ["0"]);
    const result = await adapter.download({
      ...input,
      onMetadata: () => {
        duplicate = expect(
          adapter.download({
            ...input,
            downloadDir: path.join(workspace, "duplicate"),
            onMetadata: duplicateMetadata,
          }),
        ).rejects.toThrow("duplicate torrent");
        return ["1"];
      },
    });
    await duplicate;
    expect(duplicateMetadata).not.toHaveBeenCalled();
    expect(
      add.mock.calls
        .filter(([value]) => value === source)
        .every(
          ([, options]) =>
            options && "deselect" in options && options.deselect === true,
        ),
    ).toBe(true);
    expect(result.files).toEqual(["seed/1.bin"]);
    expect(
      await readFile(path.join(input.downloadDir, result.files[0] ?? "")),
    ).toEqual(contents[1]);
    const last = progress.at(-1);
    expect(last).toMatchObject({
      progress: 1,
      downloadedBytes: contents[1]?.length,
    });
    expect(last?.files?.map((file) => file.selected)).toEqual([
      false,
      true,
      false,
    ]);
    expect(last?.files?.map((file) => file.complete)).toEqual([
      false,
      true,
      false,
    ]);
    expect(torrent.uploaded).toBeLessThan(
      contents.reduce((sum, bytes) => sum + bytes.length, 0),
    );
    expect(
      progress.every(
        (value) =>
          value.progress <= 1 &&
          value.downloadedBytes <= (contents[1]?.length ?? 0),
      ),
    ).toBe(true);

    const retained = createRetainedTorrentStore(
      path.join(workspace, "retained"),
    );
    const manager = createJobManager(new Map(), vi.fn(), retained);
    const job = manager.createJob(source);
    job.abortController = new AbortController();
    const save = vi.spyOn(retained, "save");
    const failureTimer = setTimeout(() => job.abortController?.abort(), 5_000);
    try {
      await expect(
        adapter.download({
          ...input,
          downloadDir: path.join(job.workspaceDir, "torrent"),
          signal: job.abortController.signal,
          retainStoreOnAbort: () => true,
          onMetadata: () => ["0"],
          onProgress: (value) => {
            if (value.downloadedBytes > 0)
              save.mockImplementation(() => {
                throw new Error("SQLITE_FULL");
              });
            manager.emitJob(job, {
              status: "downloading",
              downloadedBytes: value.downloadedBytes,
            });
            if (value.progress === 1) manager.closeJob(job, "ready");
          },
        }),
      ).rejects.toMatchObject({ name: "RetainedTorrentStorageError" });
      expect(job.status).toBe("error");
      expect(
        await readFile(path.join(job.workspaceDir, "torrent/seed/0.bin")),
      ).toEqual(contents[0]);
    } finally {
      clearTimeout(failureTimer);
      save.mockRestore();
      retained.close();
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
    add.mockRestore();
    await adapter.close();
    await new Promise<void>((resolve) => seed.destroy(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
}, 30_000);

it("changes real piece scheduling and shares bandwidth controls across active torrents", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "torrent-priority-"));
  const seedDir = path.join(workspace, "seed");
  await mkdir(seedDir);
  // One shared boundary piece must not promote all of the low-priority file.
  const contents = [randomBytes(32 * 16_384 + 13), randomBytes(32 * 16_384)];
  await Promise.all(
    contents.map((bytes, i) =>
      writeFile(path.join(seedDir, `${i}.bin`), bytes),
    ),
  );
  const seed = new WebTorrent({
    dht: false,
    tracker: false,
    lsd: false,
    utp: false,
    natUpnp: false,
    natPmp: false,
  });
  const adapter = createWebTorrentAdapter();
  const add = vi.spyOn(WebTorrent.prototype, "add");
  const down = vi.spyOn(WebTorrent.prototype, "throttleDownload");
  const up = vi.spyOn(WebTorrent.prototype, "throttleUpload");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const seedOptions = { announce: [], pieceLength: 16_384 };
    const otherOptions = { name: "other.bin", announce: [] };
    const torrent = await new Promise<Torrent>((resolve) =>
      seed.seed(seedDir, seedOptions, resolve),
    );
    const other = await new Promise<Torrent>((resolve) =>
      seed.seed(Buffer.from("Another active torrent"), otherOptions, resolve),
    );
    const requestedPieces: number[] = [];
    torrent.on("wire", (wire) =>
      wire.on("request", (index) => requestedPieces.push(index)),
    );
    const address = seed.address();
    if (!address || typeof address === "string")
      throw new Error("Local seeder has no TCP port");
    const input = {
      signal: controller.signal,
      retainStoreOnAbort: () => false,
      onNoPeers: () => undefined,
      onMetadata: () => ["0"],
      onProgress: () => undefined,
    };
    let otherReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      otherReady = resolve;
    });
    const otherDownload = adapter
      .download({
        ...input,
        jobId: "other",
        source: other.torrentFile,
        downloadDir: path.join(workspace, "other"),
        onProgress: otherReady,
      })
      .catch((error: unknown) => error);
    await ready;
    let changed = false;
    await adapter.download({
      ...input,
      jobId: "priority",
      source: torrent.torrentFile,
      downloadDir: path.join(workspace, "download"),
      onMetadata: () => ["0", "1"],
      priorities: { "0": "low", "1": "normal" },
      onProgress: () => {
        if (changed) return;
        changed = true;
        expect(() =>
          adapter.setFilePriority?.("priority", "unknown", "high"),
        ).toThrow("actively downloading");
        adapter.setFilePriority?.("priority", "1", "high");
        adapter.setFilePriority?.("other", "0", "low");
        expect(
          adapter.setLimits?.({
            downloadBytesPerSec: 512 * 1024,
            uploadBytesPerSec: 256 * 1024,
          }),
        ).toEqual({
          downloadBytesPerSec: 512 * 1024,
          uploadBytesPerSec: 256 * 1024,
        });
        const client = down.mock.contexts.at(-1);
        expect(up.mock.contexts.at(-1)).toBe(client);
        expect(add.mock.contexts.slice(-2)).toEqual([client, client]);
        expect(down).toHaveBeenLastCalledWith(512 * 1024);
        expect(up).toHaveBeenLastCalledWith(256 * 1024);
        expect(adapter.getLimits?.()).toEqual({
          downloadBytesPerSec: 512 * 1024,
          uploadBytesPerSec: 256 * 1024,
        });
        const activeTorrent = add.mock.results.at(-1)?.value as Torrent;
        activeTorrent.addPeer(`127.0.0.1:${String(address.port)}`);
      },
    });
    expect(requestedPieces.length).toBeGreaterThan(5);
    // WebTorrent probes one low-priority piece to validate a new peer first.
    expect(
      requestedPieces.slice(1, 6).every((piece) => piece >= 32),
      requestedPieces.slice(0, 8).join(","),
    ).toBe(true);
    expect(
      await readFile(path.join(workspace, "download", "seed", "0.bin")),
    ).toEqual(contents[0]);
    expect(
      await readFile(path.join(workspace, "download", "seed", "1.bin")),
    ).toEqual(contents[1]);
    expect(() => adapter.setFilePriority?.("priority", "1", "normal")).toThrow(
      "actively downloading",
    );
    adapter.setLimits?.({ downloadBytesPerSec: 0, uploadBytesPerSec: 0 });
    expect(down).toHaveBeenLastCalledWith(-1);
    expect(up).toHaveBeenLastCalledWith(-1);
    controller.abort();
    expect(await otherDownload).toMatchObject({ name: "AbortError" });
  } finally {
    clearTimeout(timer);
    controller.abort();
    add.mockRestore();
    down.mockRestore();
    up.mockRestore();
    await adapter.close();
    await new Promise<void>((resolve) => seed.destroy(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
}, 30_000);
