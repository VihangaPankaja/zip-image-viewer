import { statfsSync, statSync } from "node:fs";
import { Transform } from "node:stream";

export const MAX_RESOURCE_BYTES = 10 * 1024 ** 3;
const MAX_RESOURCE_ENTRIES = 10_000;
const STORAGE_HEADROOM_BYTES = 64 * 1024 ** 2;
const reservations = new Map<number, Map<symbol, number>>();

export function resourceLimitError(message: string): Error {
  return Object.assign(new Error(message), { code: "DOWNLOAD_FATAL" });
}

export function assertResourceSize(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_RESOURCE_BYTES)
    throw resourceLimitError(
      "Download or extraction exceeds the 10 GiB limit.",
    );
}

export function assertResourceEntryCount(count: number): void {
  if (count > MAX_RESOURCE_ENTRIES)
    throw resourceLimitError(
      "Download or extraction exceeds the 10000 entry limit.",
    );
}

export function reserveStorage(directory: string, bytes: number) {
  const device = statSync(directory).dev;
  const entries = reservations.get(device) ?? new Map<symbol, number>();
  const key = Symbol();
  const available = () => {
    const { bavail, bsize } = statfsSync(directory);
    return bavail * bsize;
  };
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes +
      [...entries.values()].reduce((total, value) => total + value, 0) +
      STORAGE_HEADROOM_BYTES >
      available()
  )
    throw resourceLimitError(
      "Insufficient storage for this download or extraction.",
    );
  entries.set(key, bytes);
  reservations.set(device, entries);
  return {
    check: () => {
      if (available() < STORAGE_HEADROOM_BYTES)
        throw resourceLimitError(
          "Insufficient storage for this download or extraction.",
        );
    },
    release: () => {
      entries.delete(key);
      if (!entries.size) reservations.delete(device);
    },
  };
}

export function createDownloadBudget(
  maxBytes: () => number,
  state: { downloadedBytes: number },
  checkStorage: () => void,
): Transform {
  let received = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        received += chunk.length;
        if (received > maxBytes())
          throw resourceLimitError(
            "Response exceeds the allowed download size.",
          );
        checkStorage();
        state.downloadedBytes += chunk.length;
        callback(null, chunk);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
}
