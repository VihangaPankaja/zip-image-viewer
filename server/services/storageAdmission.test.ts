import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import WebTorrent, { type Torrent } from "webtorrent";
import { downloadWithSegmentedManager } from "./segmentedDownloader.js";
import { createWebTorrentAdapter } from "../application/torrents/torrentDownloader.js";

const disk = vi.hoisted(() => ({ free: 64 * 1024 ** 2 + 120 }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  statfsSync: () => ({ bsize: 1, bavail: disk.free }),
}));
const workspaces: string[] = [];
afterEach(async () => {
  disk.free = 64 * 1024 ** 2 + 120;
  await Promise.all(
    workspaces
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), "resource-admission-"));
  workspaces.push(directory);
  return directory;
}

function transfer(url: string, targetPath: string, size = 80) {
  return downloadWithSegmentedManager({
    url,
    targetPath,
    signal: new AbortController().signal,
    state: { downloadedBytes: 0 },
    metadata: { size, acceptRanges: false },
    settings: {
      enableResume: false,
      enableMultithread: false,
      threadCount: 1,
      maxRetries: 0,
    },
  });
}

it("reserves storage across active HTTP jobs and releases it without changing retained files", async () => {
  const directory = await workspace();
  const retained = path.join(directory, "retained.bin");
  await writeFile(retained, "retained bytes");
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let requests = 0;
  const server = createServer((_request, response) => {
    if (requests++ > 0) {
      response.end(Buffer.alloc(80, 7));
      return;
    }
    finish = () => response.end(Buffer.alloc(80, 7));
    started();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP port");
  const url = `http://127.0.0.1:${String(address.port)}/file`;
  let active: Promise<void> | undefined;
  try {
    active = transfer(url, path.join(directory, "first.bin"));
    await ready;
    await expect(
      transfer(url, path.join(directory, "second.bin")),
    ).rejects.toThrow("storage");
    finish();
    await active;
    const resumed = transfer(url, path.join(directory, "second.bin"));
    await resumed;
    expect(await readFile(retained, "utf8")).toBe("retained bytes");
    expect(await readFile(path.join(directory, "first.bin"))).toEqual(
      Buffer.alloc(80, 7),
    );
    expect(await readFile(path.join(directory, "second.bin"))).toEqual(
      Buffer.alloc(80, 7),
    );
  } finally {
    finish();
    await active?.catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("rejects a confirmed HTTP payload above the hard transfer limit", async () => {
  const directory = await workspace();
  await expect(
    transfer(
      "http://127.0.0.1:1/file",
      path.join(directory, "large.bin"),
      10 * 1024 ** 3 + 1,
    ),
  ).rejects.toThrow("10 GiB");
});

it("rejects an exhausted torrent selection before transfer and preserves retained data", async () => {
  const directory = await workspace();
  const seedDirectory = path.join(directory, "seed");
  const downloadDirectory = path.join(directory, "download");
  await mkdir(seedDirectory);
  await mkdir(downloadDirectory);
  await writeFile(path.join(seedDirectory, "large.bin"), Buffer.alloc(160, 1));
  await writeFile(path.join(downloadDirectory, "other.bin"), "retained bytes");
  const seed = new WebTorrent({
    dht: false,
    tracker: false,
    lsd: false,
    utp: false,
    natUpnp: false,
    natPmp: false,
  });
  const adapter = createWebTorrentAdapter();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  try {
    const torrent = await new Promise<Torrent>((resolve) =>
      seed.seed(seedDirectory, { announce: [] }, resolve),
    );
    await expect(
      adapter.download({
        source: torrent.torrentFile,
        downloadDir: downloadDirectory,
        signal: controller.signal,
        retainStoreOnAbort: () => true,
        onMetadata: () => ["0"],
        onProgress: () => undefined,
        onNoPeers: () => undefined,
      }),
    ).rejects.toThrow("storage");
    expect(
      await readFile(path.join(downloadDirectory, "other.bin"), "utf8"),
    ).toBe("retained bytes");
  } finally {
    clearTimeout(timer);
    await adapter.close();
    await new Promise<void>((resolve) => seed.destroy(() => resolve()));
  }
});

it("rejects oversized torrent file tables before offering selection", async () => {
  const directory = await workspace();
  const files = Array.from(
    { length: 10_001 },
    (_, index) =>
      `d6:lengthi1e4:pathl${String(String(index).length)}:${String(index)}ee`,
  ).join("");
  const source = Buffer.from(
    `d4:infod5:filesl${files}e4:name7:fixture12:piece lengthi16384e6:pieces20:${"a".repeat(20)}ee`,
  );
  const adapter = createWebTorrentAdapter();
  try {
    await expect(
      adapter.download({
        source,
        downloadDir: directory,
        signal: new AbortController().signal,
        retainStoreOnAbort: () => true,
        onMetadata: () => {
          throw new Error("Selection offered");
        },
        onProgress: () => undefined,
        onNoPeers: () => undefined,
      }),
    ).rejects.toThrow("10000");
  } finally {
    await adapter.close();
  }
}, 30_000);
