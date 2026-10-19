import { setTimeout as delay } from "node:timers/promises";
import type { Readable } from "node:stream";
import type { Torrent } from "webtorrent";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { verifiedTorrentStream } from "./verifiedTorrentStream.js";

const readers: Readable[] = [];
afterEach(() => {
  for (const reader of readers.splice(0)) reader.destroy();
  vi.restoreAllMocks();
});

function fixture(length = 12) {
  const verified = new Set<number>();
  const bytes = Buffer.from("abcdefghijkl");
  const get = vi.fn(
    (
      piece: number,
      range: { offset: number; length: number },
      done: (_error: null, _bytes: Buffer) => void,
    ) => {
      const start = piece * 4 + range.offset;
      done(null, bytes.subarray(start, start + range.length));
    },
  );
  const torrent = {
    pieceLength: 4,
    destroyed: false,
    bitfield: { get: (piece: number) => verified.has(piece) },
    store: { get },
    _selections: [],
    _select: vi.fn(),
    _updateSelections: vi.fn(),
  } as unknown as Torrent;
  const file = { offset: 0 } as Torrent["files"][number];
  const stream = verifiedTorrentStream(
    torrent,
    file,
    { start: 0, end: length - 1 },
    new AbortController().signal,
    10,
  );
  stream.on("error", () => undefined);
  readers.push(stream);
  return { stream, verified, get, bytes };
}

it("expires an idle missing-piece read without returning unverified bytes", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { stream, get } = fixture(4);
  const outcome = stream[Symbol.asyncIterator]()
    .next()
    .catch((error: unknown) => error);
  await delay(75);
  now = 120_001;
  const failure: unknown = await outcome;
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(/timed out/i);
  expect(get).not.toHaveBeenCalled();
});

it("resets the idle deadline as pieces arrive during a stream longer than two minutes", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { stream, verified, bytes } = fixture();
  verified.add(0);
  const iterator = stream[Symbol.asyncIterator]();
  const chunks = [Buffer.from((await iterator.next()).value as Uint8Array)];
  for (const piece of [1, 2]) {
    await delay(75);
    now += 110_000;
    verified.add(piece);
    chunks.push(Buffer.from((await iterator.next()).value as Uint8Array));
  }
  expect(Buffer.concat(chunks)).toEqual(bytes);
  expect(now).toBeGreaterThan(120_000);
  expect((await iterator.next()).done).toBe(true);
});
