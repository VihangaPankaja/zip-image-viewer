import WebTorrent, { type Torrent } from "webtorrent";
import type { TorrentFile } from "../../../shared/contracts.js";
import { validateTorrentFilePath } from "./torrentSource.js";

export const MAX_TORRENT_METADATA_BYTES = 10 * 1024 * 1024;

export type TorrentMetadata = {
  files: TorrentFile[];
  torrentFile?: Uint8Array;
  length: number;
  name: string;
};

export type TorrentProgress = {
  files?: TorrentFile[];
  downloadedBytes: number;
  downloadSpeedBytesPerSec: number;
  peerCount: number;
  progress: number;
  uploadedBytes: number;
  uploadSpeedBytesPerSec: number;
};

export type TorrentDownloadInput = {
  source: string | Uint8Array;
  downloadDir: string;
  signal: AbortSignal;
  retainStoreOnAbort: () => boolean;
  onMetadata: (_metadata: TorrentMetadata) => string[];
  onProgress: (_progress: TorrentProgress) => void;
  onNoPeers: () => void;
};

export type TorrentAdapter = {
  download: (_input: TorrentDownloadInput) => Promise<{ files: string[] }>;
  close: () => Promise<void>;
};

export async function fetchTorrentMetadata(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetcher(url, { redirect: "follow", signal });
  if (!response.ok) {
    throw new Error(
      `Torrent metadata request failed with HTTP ${String(response.status)}.`,
    );
  }
  const declared = Number(response.headers.get("content-length")) || 0;
  if (declared > MAX_TORRENT_METADATA_BYTES) {
    throw new Error("Torrent metadata exceeds the 10 MiB limit.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Torrent metadata response has no body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_TORRENT_METADATA_BYTES) {
      await reader.cancel();
      throw new Error("Torrent metadata exceeds the 10 MiB limit.");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function describeTorrentFiles(
  torrent: Torrent,
  directory: string,
): TorrentFile[] {
  return torrent.files.map((file, index) => {
    validateTorrentFilePath(directory, file.path);
    return {
      id: String(index),
      path: file.path.replaceAll("\\", "/"),
      size: file.length,
      selected: false,
      downloadedBytes: 0,
      complete: false,
    };
  });
}

function selectedProgress(
  torrent: Torrent,
  selectedIds: Set<string>,
): TorrentProgress {
  const files = torrent.files.map((file, index) => {
    let downloadedBytes = 0;
    const end = file.offset + file.length;
    for (
      let piece = Math.floor(file.offset / torrent.pieceLength);
      piece * torrent.pieceLength < end;
      piece += 1
    ) {
      if (torrent.pieces[piece] === null) {
        downloadedBytes +=
          Math.min(end, (piece + 1) * torrent.pieceLength) -
          Math.max(file.offset, piece * torrent.pieceLength);
      }
    }
    return {
      id: String(index),
      path: file.path.replaceAll("\\", "/"),
      size: file.length,
      selected: selectedIds.has(String(index)),
      downloadedBytes,
      complete: file.done,
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

function selectFiles(
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
    throw new Error("Choose one or more known torrent files.");
  }
  return ids;
}

export function createWebTorrentAdapter(): TorrentAdapter {
  const client = new WebTorrent({ utp: false });
  return {
    download: (input) =>
      new Promise((resolve, reject) => {
        let settled = false;
        let selectedIds = new Set<string>();
        let metadataReady = false;
        let resultFiles: string[] = [];
        const torrent = client.add(
          input.source,
          { path: input.downloadDir, deselect: true },
          (readyTorrent) => {
            if (settled || readyTorrent !== torrent) return;
            try {
              selectedIds = selectFiles(readyTorrent, input);
              resultFiles = readyTorrent.files
                .filter((_file, index) => selectedIds.has(String(index)))
                .map((file) => file.path.replaceAll("\\", "/"));
              metadataReady = true;
              readyTorrent.files.forEach((file, index) => {
                if (selectedIds.has(String(index))) file.select();
              });
              emitProgress();
            } catch (error) {
              finish(
                error instanceof Error
                  ? error
                  : new Error("Invalid torrent metadata."),
              );
            }
          },
        );
        const finish = (error?: Error, destroy = true) => {
          if (settled) return;
          settled = true;
          input.signal.removeEventListener("abort", abort);
          clearInterval(progressTimer);
          const complete = (cleanupError?: Error) => {
            if (error) reject(error);
            else if (cleanupError) reject(cleanupError);
            else resolve({ files: resultFiles });
          };
          if (!destroy) complete();
          else
            torrent.destroy(
              { destroyStore: Boolean(error) && !input.retainStoreOnAbort() },
              complete,
            );
        };
        const abort = () =>
          finish(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        const emitProgress = () => {
          if (settled || !metadataReady) return;
          const progress = selectedProgress(torrent, selectedIds);
          input.onProgress(progress);
          if (
            progress.files
              ?.filter((file) => file.selected)
              .every((file) => file.complete)
          )
            finish();
        };
        const progressTimer = setInterval(emitProgress, 250);
        progressTimer.unref();
        torrent.on("download", emitProgress);
        torrent.on("upload", emitProgress);
        torrent.on("noPeers", input.onNoPeers);
        torrent.once("error", (error) =>
          finish(error instanceof Error ? error : new Error(error), false),
        );
        input.signal.addEventListener("abort", abort, { once: true });
        if (input.signal.aborted) abort();
      }),
    close: () =>
      new Promise((resolve, reject) => {
        client.destroy((error) => (error ? reject(error) : resolve()));
      }),
  };
}
