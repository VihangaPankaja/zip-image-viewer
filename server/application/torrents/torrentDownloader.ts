import WebTorrent from "webtorrent";
import { validateTorrentFilePath } from "./torrentSource.js";

export const MAX_TORRENT_METADATA_BYTES = 10 * 1024 * 1024;

export type TorrentMetadata = {
  files: string[];
  length: number;
  name: string;
};

export type TorrentProgress = {
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
  onMetadata: (_metadata: TorrentMetadata) => void;
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

export function createWebTorrentAdapter(): TorrentAdapter {
  const client = new WebTorrent({ utp: false });
  return {
    download: (input) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const torrent = client.add(
          input.source,
          { path: input.downloadDir },
          (readyTorrent) => {
            try {
              const files = readyTorrent.files.map(({ path }) => {
                validateTorrentFilePath(input.downloadDir, path);
                return path;
              });
              input.onMetadata({
                files,
                length: readyTorrent.length,
                name: readyTorrent.name,
              });
            } catch (error) {
              finish(
                error instanceof Error
                  ? error
                  : new Error("Invalid torrent metadata."),
              );
            }
          },
        );
        const remove = (destroyStore: boolean, callback: () => void) => {
          void client.remove(
            torrent.infoHash || input.source,
            { destroyStore },
            callback,
          );
        };
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          input.signal.removeEventListener("abort", abort);
          clearInterval(progressTimer);
          remove(Boolean(error) && !input.retainStoreOnAbort(), () => {
            if (error) reject(error);
            else resolve({ files: torrent.files.map(({ path }) => path) });
          });
        };
        const abort = () =>
          finish(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        const emitProgress = () =>
          input.onProgress({
            downloadedBytes: torrent.downloaded,
            downloadSpeedBytesPerSec: torrent.downloadSpeed,
            peerCount: torrent.numPeers,
            progress: torrent.progress,
            uploadedBytes: torrent.uploaded,
            uploadSpeedBytesPerSec: torrent.uploadSpeed,
          });
        const progressTimer = setInterval(emitProgress, 250);
        progressTimer.unref();
        torrent.on("download", emitProgress);
        torrent.on("upload", emitProgress);
        torrent.on("noPeers", input.onNoPeers);
        torrent.once("done", () => finish());
        torrent.once("error", (error) =>
          finish(error instanceof Error ? error : new Error(error)),
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
