import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebTorrent, { type Torrent } from "webtorrent";
import { expect, it, vi } from "vitest";
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
  } finally {
    clearTimeout(timer);
    controller.abort();
    add.mockRestore();
    await adapter.close();
    await new Promise<void>((resolve) => seed.destroy(() => resolve()));
    await rm(workspace, { recursive: true, force: true });
  }
}, 30_000);
