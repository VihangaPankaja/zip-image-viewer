import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import type { Torrent } from "webtorrent";
export type TorrentByteRange = { start: number; end: number };

type Scheduler = Torrent & {
  destroyed: boolean;
  bitfield: { get: (_piece: number) => boolean };
  store: {
    get: (
      _piece: number,
      _range: { offset: number; length: number },
      _callback: (_error: Error | null, _bytes?: Uint8Array) => void,
    ) => void;
  };
  _select: (
    _from: number,
    _to: number,
    _priority: number,
    _notify: () => void,
    _stream: boolean,
  ) => void;
  _selections: Iterable<{ notify?: () => void; remove: () => void }>;
  _updateSelections: () => void;
};

function assertTorrentOpen(torrent: Scheduler) {
  if (torrent.destroyed) throw new Error("Torrent playback stopped.");
}

export function verifiedTorrentStream(
  torrent: Torrent,
  file: Torrent["files"][number],
  range: TorrentByteRange,
  signal: AbortSignal,
  priority: number,
): Readable {
  const cancellation = new AbortController();
  const combined = AbortSignal.any([signal, cancellation.signal]);
  const scheduler = torrent as Scheduler;
  const notify = () => undefined;
  const clearSelection = () => {
    if (scheduler.destroyed) return;
    // Remove this reader's selection by identity, preserving overlapping file priorities.
    for (const selection of scheduler._selections) {
      if (selection.notify === notify) selection.remove();
    }
    scheduler._updateSelections();
  };
  async function* chunks() {
    try {
      for (let position = range.start; position <= range.end;) {
        combined.throwIfAborted();
        assertTorrentOpen(scheduler);
        const absolute = file.offset + position;
        const piece = Math.floor(absolute / torrent.pieceLength);
        const offset = absolute % torrent.pieceLength;
        const length = Math.min(torrent.pieceLength - offset, range.end - position + 1);
        clearSelection();
        const endPiece = Math.min(
          piece + 2,
          Math.floor((file.offset + range.end) / torrent.pieceLength),
        );
        scheduler._select(piece, endPiece, priority, notify, true);
        const waitingSince = Date.now();
        while (!scheduler.bitfield.get(piece)) {
          if (Date.now() - waitingSince >= 120_000)
            throw new Error("Waiting for verified torrent pieces timed out.");
          await delay(50, undefined, { signal: combined });
          assertTorrentOpen(scheduler);
        }
        // Only the verified bitfield authorizes reading the chunk store.
        const bytes = await new Promise<Buffer>((resolve, reject) => {
          scheduler.store.get(piece, { offset, length }, (error, buffer) => {
            if (error !== null) reject(error);
            else if (!buffer || buffer.length !== length)
              reject(new Error("Incomplete verified torrent read."));
            else resolve(Buffer.from(buffer));
          });
        });
        combined.throwIfAborted();
        yield bytes;
        position += length;
      }
    } finally {
      clearSelection();
    }
  }
  const stream = Readable.from(chunks(), { highWaterMark: 1 });
  const destroy = stream._destroy.bind(stream);
  stream._destroy = (error, callback) => {
    cancellation.abort();
    destroy(error, callback);
  };
  stream.once("close", () => {
    cancellation.abort();
    clearSelection();
  });
  const abort = () => stream.destroy(new Error("Torrent playback stopped."));
  combined.addEventListener("abort", abort, { once: true });
  stream.once("close", () => combined.removeEventListener("abort", abort));
  return stream;
}
