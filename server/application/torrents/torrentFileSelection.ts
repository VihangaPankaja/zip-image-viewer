import type { Torrent } from "webtorrent";
import type {
  TorrentFile,
  TorrentPriority,
} from "../../../shared/contracts.js";
import type {
  TorrentDownloadInput,
  TorrentProgress,
} from "./torrentDownloader.js";
import { MAX_TORRENT_METADATA_BYTES } from "./torrentSource.js";
import { validateTorrentFilePath } from "./torrentSource.js";
import {
  assertResourceEntryCount,
  assertResourceSize,
  reserveStorage,
  resourceLimitError,
} from "../../infrastructure/runtime/resourceLimits.js";
const webTorrentPriority = { low: 0, normal: 1, high: 2 } as const;
export function describeTorrentFiles(
  torrent: Torrent,
  directory: string,
): TorrentFile[] {
  assertResourceEntryCount(torrent.files.length);
  if (torrent.torrentFile.length > MAX_TORRENT_METADATA_BYTES)
    throw resourceLimitError("Torrent metadata exceeds the 10 MiB limit.");
  return torrent.files.map((file, index) => {
    validateTorrentFilePath(directory, file.path);
    if (!Number.isSafeInteger(file.length) || file.length < 0)
      throw resourceLimitError("Torrent contains an invalid file size.");
    return {
      id: String(index),
      path: file.path.replaceAll("\\", "/"),
      size: file.length,
      selected: false,
      downloadedBytes: verifiedFileBytes(torrent, file),
      complete: verifiedFileBytes(torrent, file) === file.length,
      priority: "normal",
    };
  });
}

function verifiedFileBytes(torrent: Torrent, file: Torrent["files"][number]) {
  let downloadedBytes = 0;
  const end = file.offset + file.length;
  for (
    let piece = Math.floor(file.offset / torrent.pieceLength);
    piece * torrent.pieceLength < end;
    piece += 1
  ) {
    if (torrent.pieces[piece] === null)
      downloadedBytes +=
        Math.min(end, (piece + 1) * torrent.pieceLength) -
        Math.max(file.offset, piece * torrent.pieceLength);
  }
  return downloadedBytes;
}

export function selectedProgress(
  torrent: Torrent,
  selectedIds: Set<string>,
  priorities: Map<string, TorrentPriority>,
): TorrentProgress {
  const files = torrent.files.map((file, index) => {
    const downloadedBytes = verifiedFileBytes(torrent, file);
    return {
      id: String(index),
      path: file.path.replaceAll("\\", "/"),
      size: file.length,
      selected: selectedIds.has(String(index)),
      downloadedBytes,
      complete: downloadedBytes === file.length,
      priority: priorities.get(String(index)) ?? "normal",
    };
  });
  const selected = files.filter((file) => file.selected);
  const total = selected.reduce((sum, file) => sum + file.size, 0);
  const downloadedBytes = selected.reduce(
    (sum, file) => sum + file.downloadedBytes,
    0,
  );
  return {
    files,
    downloadedBytes,
    downloadSpeedBytesPerSec: torrent.downloadSpeed,
    peerCount: torrent.numPeers,
    progress: total ? downloadedBytes / total : 1,
    uploadedBytes: torrent.uploaded,
    uploadSpeedBytesPerSec: torrent.uploadSpeed,
  };
}

export function selectFiles(
  torrent: Torrent,
  input: TorrentDownloadInput,
): Set<string> {
  const files = describeTorrentFiles(torrent, input.downloadDir);
  const ids = new Set(
    input.onMetadata({
      files,
      length: torrent.length,
      name: torrent.name,
      torrentFile: torrent.torrentFile,
    }),
  );
  if (
    !ids.size ||
    [...ids].some((id) => !files.some((file) => file.id === id))
  ) {
    throw resourceLimitError("Choose one or more known torrent files.");
  }
  return ids;
}

export function applyFilePriorities(
  torrent: Torrent,
  selectedIds: Set<string>,
  priorities: Map<string, TorrentPriority>,
  ranges: [number, number][],
) {
  // WebTorrent 3 merges adjacent public selections, including their priorities.
  // Its stream selections preserve separate ranges and normal scheduling.
  const scheduler = torrent as Torrent & {
    _select: (
      start: number,
      end: number,
      priority: number,
      notify: undefined,
      stream: boolean,
    ) => void;
    _deselect: (start: number, end: number, stream: boolean) => void;
  };
  for (const [start, end] of ranges) scheduler._deselect(start, end, true);
  ranges.length = 0;
  // Shared boundary pieces take the higher priority without merging whole files.
  const pieces = new Uint8Array(torrent.pieces.length);
  torrent.files.forEach((file, index) => {
    if (!selectedIds.has(String(index)) || !file.length) return;
    const priority =
      webTorrentPriority[priorities.get(String(index)) ?? "normal"] + 1;
    const end = Math.ceil((file.offset + file.length) / torrent.pieceLength);
    for (
      let piece = Math.floor(file.offset / torrent.pieceLength);
      piece < end;
      piece += 1
    )
      pieces[piece] = Math.max(pieces[piece], priority);
  });
  if (!pieces.length) return;
  torrent.deselect(0, pieces.length - 1);
  for (let start = 0; start < pieces.length;) {
    let end = start + 1;
    while (end < pieces.length && pieces[end] === pieces[start]) end += 1;
    if (pieces[start]) {
      scheduler._select(start, end - 1, pieces[start] - 1, undefined, true);
      ranges.push([start, end - 1]);
    }
    start = end;
  }
}

export function reserveTorrentSelection(
  torrent: Torrent,
  selectedIds: Set<string>,
  directory: string,
) {
  const pieces = new Set<number>();
  torrent.files.forEach((file, index) => {
    if (!selectedIds.has(String(index)) || !file.length) return;
    for (
      let piece = Math.floor(file.offset / torrent.pieceLength);
      piece * torrent.pieceLength < file.offset + file.length;
      piece += 1
    )
      pieces.add(piece);
  });
  let bytes = 0;
  let missingBytes = 0;
  for (const piece of pieces) {
    const size = Math.min(
      torrent.pieceLength,
      torrent.length - piece * torrent.pieceLength,
    );
    bytes += size;
    if (torrent.pieces[piece] !== null) missingBytes += size;
  }
  assertResourceSize(bytes);
  return reserveStorage(directory, missingBytes);
}
