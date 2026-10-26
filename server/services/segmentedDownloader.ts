import { rm, rename } from "node:fs/promises";
import path from "node:path";
import { mergeSegmentParts } from "../infrastructure/downloads/downloadFiles.js";
import { sleepWithSignal } from "../infrastructure/runtime/mediaClassification.js";
import { streamSingleRange } from "../infrastructure/downloads/rangeDownload.js";
import {
  assertResourceSize,
  MAX_RESOURCE_BYTES,
  reserveStorage,
} from "../infrastructure/runtime/resourceLimits.js";

import type { HttpDownloadState } from "../../shared/contracts.js";
import {
  rangeValidator,
  reconcileHttpFiles,
  verifyHttpSource,
  prepareHttpCheckpoint,
  type HttpCheckpoint,
  type HttpFileCheckpoint,
} from "../infrastructure/downloads/httpCheckpoint.js";

const UNLIMITED_RETRIES = -1;
const RETRY_BASE_DELAY_MS = 1200;

type DownloadState = { downloadedBytes: number };
type RemoteMetadata = {
  acceptRanges: boolean;
  size: number;
  etag?: string;
  lastModified?: string;
  resolvedUrl?: string;
};
type DownloadSettings = {
  enableResume: boolean;
  enableMultithread: boolean;
  threadCount: number;
  maxRetries: number;
};
type Segment = { index: number; start: number; end: number };

function getErrorProperty(error: unknown, property: "name" | "code"): string {
  if (error instanceof Error && property === "name") return error.name;
  if (typeof error !== "object" || error === null) return "";
  const value: unknown = Reflect.get(error, property);
  return typeof value === "string" ? value : "";
}

function buildSegments(totalSize: number, segmentCount: number): Segment[] {
  const safeCount = Math.max(1, Math.min(totalSize, Math.floor(segmentCount)));
  const sizePerSegment = Math.floor(totalSize / safeCount);
  const segments: Segment[] = [];

  let start = 0;
  for (let i = 0; i < safeCount; i += 1) {
    const end = i === safeCount - 1 ? totalSize - 1 : start + sizePerSegment - 1;
    segments.push({ index: i, start, end });
    start = end + 1;
  }

  return segments;
}

async function downloadSingleWithResume({
  url,
  targetPath,
  state,
  metadata,
  settings,
  signal,
  storage,
  validator,
  retained,
  save,
}: {
  url: string;
  targetPath: string;
  state: DownloadState;
  metadata: RemoteMetadata;
  settings: DownloadSettings;
  signal: AbortSignal;
  storage: ReturnType<typeof reserveStorage>;
  validator: string;
  retained: HttpDownloadState;
  save: () => void;
}): Promise<void> {
  const file = retained.files[0];
  const existingBytes = file.bytes;

  state.downloadedBytes = existingBytes;

  const canRangeResume = metadata.acceptRanges && metadata.size > 0;
  const shouldRangeResume = settings.enableResume && existingBytes > 0 && canRangeResume;
  const start = shouldRangeResume ? existingBytes : 0;
  if (shouldRangeResume && existingBytes === metadata.size) return;
  const end = metadata.size > 0 ? metadata.size - 1 : Number.NaN;

  await streamSingleRange({
    url,
    targetPath,
    requestedStart: shouldRangeResume ? start : Number.NaN,
    requestedEnd: shouldRangeResume ? end : Number.NaN,
    state,
    signal,
    strictRange: shouldRangeResume,
    checkStorage: storage.check,
    maxBytes: (metadata.size || MAX_RESOURCE_BYTES) - start,
    validator,
    totalSize: metadata.size,
    resolvedUrl: shouldRangeResume ? retained.resolvedUrl : metadata.resolvedUrl,
    file,
    save,
    responseHeader: (response, encoded) => {
      if (!shouldRangeResume) {
        metadata.size = Number(response.headers["content-length"]) || 0;
        metadata.resolvedUrl = (response.url || metadata.resolvedUrl || url).split("#", 1)[0];
        metadata.etag = response.headers.etag;
        metadata.lastModified = response.headers["last-modified"];
      }
      if (encoded) {
        storage.reserveAvailable();
        metadata.size = 0;
      }
      retained.resolvedUrl = metadata.resolvedUrl || retained.resolvedUrl;
      retained.size = metadata.size;
      retained.validator = rangeValidator(metadata);
      file.end = metadata.size ? metadata.size - 1 : null;
      save();
    },
  });
}

async function downloadSegmentWithRetry({
  url,
  segment,
  targetPath,
  settings,
  state,
  signal,
  checkStorage,
  validator,
  totalSize,
  resolvedUrl,
  file,
  save,
}: {
  url: string;
  segment: Segment;
  targetPath: string;
  settings: DownloadSettings;
  state: DownloadState;
  signal: AbortSignal;
  checkStorage: (_receivedBytes: number) => void;
  validator: string;
  totalSize: number;
  resolvedUrl: string;
  file: HttpFileCheckpoint;
  save: () => void;
}): Promise<string> {
  const partPath = `${targetPath}.part.${String(segment.index)}`;

  for (
    let attempt = 0;
    settings.maxRetries === UNLIMITED_RETRIES || attempt <= settings.maxRetries;
    attempt += 1
  ) {
    if (signal.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }

    try {
      const previousBytes = file.bytes;
      if (!settings.enableResume) file.bytes = 0;
      await reconcileHttpFiles(targetPath, { files: [file] });
      state.downloadedBytes += file.bytes - previousBytes;
      const existingBytes = file.bytes;

      const start = segment.start + existingBytes;
      if (start > segment.end) {
        return partPath;
      }

      await streamSingleRange({
        url,
        targetPath: partPath,
        requestedStart: start,
        requestedEnd: segment.end,
        state,
        signal,
        strictRange: true,
        checkStorage,
        maxBytes: segment.end - start + 1,
        validator,
        totalSize,
        resolvedUrl,
        file,
        save,
      });

      return partPath;
    } catch (error) {
      if (
        getErrorProperty(error, "name") === "AbortError" ||
        getErrorProperty(error, "code") === "RANGE_UNSUPPORTED" ||
        getErrorProperty(error, "code") === "DOWNLOAD_FATAL" ||
        getErrorProperty(error, "code") === "SOURCE_CHANGED" ||
        (settings.maxRetries !== UNLIMITED_RETRIES && attempt >= settings.maxRetries)
      ) {
        throw error;
      }

      const delayMs = RETRY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 500);
      await sleepWithSignal(delayMs, signal);
    }
  }

  throw new Error("Segment download failed.");
}

type DownloadInput = {
  url: string;
  targetPath: string;
  signal: AbortSignal;
  settings: DownloadSettings;
  state: DownloadState;
  metadata: RemoteMetadata;
  checkpoint?: HttpCheckpoint;
};

export async function downloadWithSegmentedManager({
  url,
  targetPath,
  signal,
  settings,
  state,
  metadata,
  checkpoint,
}: DownloadInput): Promise<void> {
  assertResourceSize(metadata.size);
  const validator = rangeValidator(metadata);
  const canUseSegments =
    settings.enableMultithread &&
    settings.threadCount > 1 &&
    metadata.acceptRanges &&
    metadata.size > 0 &&
    Boolean(validator);

  const segments = canUseSegments ? buildSegments(metadata.size, settings.threadCount) : [];
  const files: HttpDownloadState["files"] = (
    canUseSegments
      ? segments
      : [{ index: -1, start: 0, end: metadata.size ? metadata.size - 1 : null }]
  ).map((file) => ({ ...file, bytes: 0, sha256: "" }));
  const { retained, save, reusedBytes } = await prepareHttpCheckpoint(
    targetPath,
    metadata,
    files,
    url,
    checkpoint,
    settings.enableResume,
    canUseSegments ? segments : undefined,
  );
  state.downloadedBytes = reusedBytes;
  const storage = reserveStorage(
    path.dirname(targetPath),
    Math.max(0, metadata.size * (canUseSegments ? 2 : 1) - reusedBytes),
  );
  try {
    if (!metadata.size) storage.reserveAvailable();
    if (!canUseSegments) {
      await downloadSingleWithResume({
        url,
        targetPath,
        state,
        metadata,
        settings,
        signal,
        storage,
        validator,
        retained,
        save,
      });
      retained.size = metadata.size || state.downloadedBytes;
      retained.files[0].end = retained.size ? retained.size - 1 : null;
      state.downloadedBytes = await verifyHttpSource(targetPath, metadata.size, retained, save);
      return;
    }

    await downloadSegments({
      url,
      targetPath,
      signal,
      settings,
      state,
      metadata,
      segments,
      retained,
      save,
      storage,
      validator,
    });
    state.downloadedBytes = await verifyHttpSource(targetPath, metadata.size, retained, save);
    await Promise.all(
      segments.map(({ index }) => rm(`${targetPath}.part.${index}`, { force: true })),
    );
  } finally {
    storage.release();
  }
}

async function downloadSegments(
  input: DownloadInput & {
    segments: Segment[];
    retained: HttpDownloadState;
    save: () => void;
    storage: ReturnType<typeof reserveStorage>;
    validator: string;
  },
) {
  const {
    url,
    targetPath,
    settings,
    state,
    metadata,
    segments,
    retained,
    save,
    storage,
    validator,
  } = input;
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const results = await Promise.allSettled(
    segments.map((segment) =>
      downloadSegmentWithRetry({
        url,
        segment,
        targetPath,
        settings,
        state,
        signal,
        checkStorage: storage.check,
        validator,
        totalSize: metadata.size,
        resolvedUrl: metadata.resolvedUrl || url,
        file: retained.files[segment.index],
        save,
      }).catch((error: unknown) => {
        controller.abort(error);
        throw error;
      }),
    ),
  );
  controller.signal.throwIfAborted();
  const partPaths = results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });

  storage.check();

  const assemblyPath = `${targetPath}.assembling`;
  await rm(assemblyPath, { force: true });
  await mergeSegmentParts(partPaths, assemblyPath, signal);
  signal.throwIfAborted();
  await rename(assemblyPath, targetPath);
}
