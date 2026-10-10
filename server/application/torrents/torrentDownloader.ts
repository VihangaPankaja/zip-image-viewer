import WebTorrent, { type Torrent } from "webtorrent";
import type {
  TorrentFile,
  TorrentLimits,
  TorrentPriority,
} from "../../../shared/contracts.js";
import {
  describeTorrentFiles,
  selectedProgress,
  selectFiles,
  applyFilePriorities,
  reserveTorrentSelection,
} from "./torrentFileSelection.js";
import { mkdirSync } from "node:fs";
import {
  reserveStorage,
  resourceLimitError,
} from "../../infrastructure/runtime/resourceLimits.js";
import { fetchWithValidatedRedirects } from "../../infrastructure/downloads/publicDownload.js";

import { MAX_TORRENT_METADATA_BYTES } from "./torrentSource.js";
export { MAX_TORRENT_METADATA_BYTES } from "./torrentSource.js";

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
  jobId?: string;
  priorities?: Record<string, TorrentPriority>;
  peerHints?: string[];
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
  setFilePriority?: (
    _jobId: string,
    _fileId: string,
    _priority: TorrentPriority,
  ) => void;
  getLimits?: () => TorrentLimits;
  setLimits?: (_limits: TorrentLimits) => TorrentLimits;
  close: () => Promise<void>;
};

export async function fetchTorrentMetadata(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array> {
  const response = await fetchWithValidatedRedirects(url, { signal }, fetcher);
  if (!response.ok) {
    throw new Error(
      `Torrent metadata request failed with HTTP ${String(response.status)}.`,
    );
  }
  const declared = Number(response.headers.get("content-length")) || 0;
  if (declared > MAX_TORRENT_METADATA_BYTES) {
    throw resourceLimitError("Torrent metadata exceeds the 10 MiB limit.");
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
      throw resourceLimitError("Torrent metadata exceeds the 10 MiB limit.");
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

type ActiveTorrent = {
  torrent: Torrent;
  selectedIds: Set<string>;
  priorities: Map<string, TorrentPriority>;
  ranges: [number, number][];
};

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("Aborted"), { name: "AbortError" });
}

function guardTorrentMetadata(
  torrent: Torrent,
  directory: string,
  finish: (_error: Error) => void,
): void {
  torrent.once("metadata", () => {
    try {
      describeTorrentFiles(torrent, directory);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function downloadTorrent(
  client: InstanceType<typeof WebTorrent>,
  active: Map<string, ActiveTorrent>,
  input: TorrentDownloadInput,
): Promise<{ files: string[] }> {
  if (
    typeof input.source !== "string" &&
    input.source.length > MAX_TORRENT_METADATA_BYTES
  )
    return Promise.reject(
      resourceLimitError("Torrent metadata exceeds the 10 MiB limit."),
    );
  mkdirSync(input.downloadDir, { recursive: true });
  return transferTorrent(client, active, input);
}

function transferTorrent(
  client: InstanceType<typeof WebTorrent>,
  active: Map<string, ActiveTorrent>,
  input: TorrentDownloadInput,
): Promise<{ files: string[] }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let selectedIds = new Set<string>();
    const priorities = new Map(Object.entries(input.priorities ?? {}));
    const ranges: [number, number][] = [];
    let resultFiles: string[] = [];
    let storage: ReturnType<typeof reserveStorage> | undefined;
    const torrent = client.add(
      input.source,
      { path: input.downloadDir, deselect: true },
      (readyTorrent) => {
        if (settled || readyTorrent !== torrent) return;
        try {
          selectedIds = selectFiles(readyTorrent, input);
          storage = reserveTorrentSelection(
            readyTorrent,
            selectedIds,
            input.downloadDir,
          );
          resultFiles = activateTorrent(active, input, {
            torrent: readyTorrent,
            selectedIds,
            priorities,
            ranges,
          });
          emitProgress();
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
    const finish = (error?: Error, destroy = true) => {
      if (settled) return;
      settled = true;
      if (input.jobId) active.delete(input.jobId);
      input.signal.removeEventListener("abort", abort);
      clearInterval(progressTimer);
      const complete = (cleanupError?: Error) => {
        storage?.release();
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
    const abort = () => finish(abortReason(input.signal));
    const emitProgress = () => {
      if (settled || !selectedIds.size) return;
      try {
        storage?.check();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (emitSelectedProgress(input, torrent, selectedIds, priorities))
        finish();
    };
    const progressTimer = setInterval(emitProgress, 250);
    guardTorrentMetadata(torrent, input.downloadDir, finish);
    torrent.on("download", emitProgress);
    torrent.on("upload", emitProgress);
    torrent.on("noPeers", input.onNoPeers);
    torrent.once("error", (error) =>
      finish(error instanceof Error ? error : new Error(error), false),
    );
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();
  });
}

function activateTorrent(
  active: Map<string, ActiveTorrent>,
  input: TorrentDownloadInput,
  entry: ActiveTorrent,
): string[] {
  applyFilePriorities(
    entry.torrent,
    entry.selectedIds,
    entry.priorities,
    entry.ranges,
  );
  for (const peer of input.peerHints ?? []) entry.torrent.addPeer(peer);
  if (input.jobId) active.set(input.jobId, entry);
  return entry.torrent.files
    .filter((_file, index) => entry.selectedIds.has(String(index)))
    .map((file) => file.path.replaceAll("\\", "/"));
}

function emitSelectedProgress(
  input: TorrentDownloadInput,
  torrent: Torrent,
  selectedIds: Set<string>,
  priorities: Map<string, TorrentPriority>,
): boolean {
  const progress = selectedProgress(torrent, selectedIds, priorities);
  input.onProgress(progress);
  return (
    progress.files
      ?.filter((file) => file.selected)
      .every((file) => file.complete) ?? false
  );
}

export function createWebTorrentAdapter(): TorrentAdapter {
  const client = new WebTorrent({ utp: false, webSeeds: false });
  const active = new Map<string, ActiveTorrent>();
  let limits: TorrentLimits = { downloadBytesPerSec: 0, uploadBytesPerSec: 0 };
  return {
    download: (input) => downloadTorrent(client, active, input),
    setFilePriority: (jobId, fileId, priority) => {
      const entry = active.get(jobId);
      if (!entry || !entry.selectedIds.has(fileId))
        throw new Error("Selected torrent file is not actively downloading.");
      entry.priorities.set(fileId, priority);
      applyFilePriorities(
        entry.torrent,
        entry.selectedIds,
        entry.priorities,
        entry.ranges,
      );
    },
    getLimits: () => ({ ...limits }),
    setLimits: (next) => {
      client.throttleDownload(next.downloadBytesPerSec || -1);
      client.throttleUpload(next.uploadBytesPerSec || -1);
      limits = { ...next };
      return { ...limits };
    },
    close: () =>
      new Promise((resolve, reject) => {
        client.destroy((error) => (error ? reject(error) : resolve()));
      }),
  };
}
