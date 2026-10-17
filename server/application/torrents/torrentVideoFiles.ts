import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { ApplicationError, type SessionJob } from "../../domain/models.js";
import type { TorrentFile } from "../../../shared/contracts.js";
import { isRealPathWithinRoot } from "../../infrastructure/runtime/filePaths.js";
import type { ActiveTorrent } from "./torrentDownloader.js";
import {
  verifiedTorrentStream,
  type TorrentByteRange,
} from "./verifiedTorrentStream.js";

export function openTorrentVideoFile(
  active: Map<string, ActiveTorrent>,
  jobId: string,
  fileId: string,
) {
  const entry = active.get(jobId);
  if (!entry)
    throw new ApplicationError(
      "CONFLICT",
      "Torrent is not actively downloading. Resume it or open the completed file in Explore.",
      409,
    );
  const file = entry.torrent.files.find(
    (_file, index) => String(index) === fileId,
  );
  if (!file)
    throw new ApplicationError("NOT_FOUND", "Torrent file not found.", 404);
  if (!entry.selectedIds.has(fileId))
    throw new ApplicationError(
      "CONFLICT",
      "Select this file for download first.",
      409,
    );
  if (entry.readers.size >= 8)
    throw new ApplicationError(
      "CONFLICT",
      "Too many active torrent playback requests. Close another preview and retry.",
      409,
    );
  const controller = new AbortController();
  const priority = ++entry.readPriority;
  entry.readers.add(controller);
  const stream = (range: TorrentByteRange, signal: AbortSignal) =>
    verifiedTorrentStream(
      entry.torrent,
      file,
      range,
      AbortSignal.any([signal, controller.signal]),
      priority,
    );
  return {
    path: file.path,
    size: file.length,
    stream,
    read: (start: number, end: number, signal: AbortSignal) =>
      collectBytes(stream({ start, end }, signal)),
    release: () => {
      controller.abort();
      const released = entry.readers.delete(controller);
      if (released && entry.completed && !entry.readers.size) {
        active.delete(jobId);
        entry.torrent.destroy({ destroyStore: false });
      }
    },
  };
}

export async function openCompletedTorrentVideoFile(
  job: SessionJob,
  file: TorrentFile,
) {
  const root = path.join(job.workspaceDir, "torrent");
  const target = path.resolve(root, file.path);
  const available = await isRealPathWithinRoot(target, root).catch(() => false);
  const stats = available ? await stat(target).catch(() => null) : null;
  if (!stats?.isFile() || stats.size !== file.size)
    throw new ApplicationError(
      "CONFLICT",
      "Downloaded video is unavailable. Resume the torrent to verify its data.",
      409,
    );
  const stream = (range: TorrentByteRange, signal: AbortSignal) =>
    createReadStream(target, { ...range, signal });
  return {
    path: file.path,
    size: file.size,
    stream,
    read: (start: number, end: number, signal: AbortSignal) =>
      collectBytes(stream({ start, end }, signal)),
    release: () => undefined,
  };
}

async function collectBytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
