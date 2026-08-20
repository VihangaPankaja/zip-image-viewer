import { createReadStream, createWriteStream } from "node:fs";
import { stat, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";
import got from "got";

const UNLIMITED_RETRIES = -1;
const RETRY_BASE_DELAY_MS = 1200;

type DownloadState = { downloadedBytes: number };
type RemoteMetadata = { acceptRanges: boolean; size: number };
type DownloadSettings = {
  enableResume: boolean;
  enableMultithread: boolean;
  threadCount: number;
  maxRetries: number;
};
type Segment = { index: number; start: number; end: number };
type RangeRequest = {
  url: string;
  targetPath: string;
  requestedStart: number;
  requestedEnd: number;
  state: DownloadState;
  signal: AbortSignal;
  strictRange: boolean;
  responseHeader?: (_statusCode: number) => void;
};

function getErrorProperty(error: unknown, property: "name" | "code"): string {
  if (error instanceof Error && property === "name") return error.name;
  if (typeof error !== "object" || error === null) return "";
  const value =
    property === "name"
      ? "name" in error
        ? error.name
        : undefined
      : "code" in error
        ? error.code
        : undefined;
  return typeof value === "string" ? value : "";
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function buildSegments(totalSize: number, segmentCount: number): Segment[] {
  if (!Number.isFinite(totalSize) || totalSize <= 0 || segmentCount <= 1) {
    return [];
  }

  const safeCount = Math.max(1, Math.floor(segmentCount));
  const sizePerSegment = Math.floor(totalSize / safeCount);
  const segments: Segment[] = [];

  let start = 0;
  for (let i = 0; i < safeCount; i += 1) {
    const end =
      i === safeCount - 1 ? totalSize - 1 : start + sizePerSegment - 1;
    segments.push({ index: i, start, end });
    start = end + 1;
  }

  return segments;
}

async function streamSingleRange({
  url,
  targetPath,
  requestedStart,
  requestedEnd,
  state,
  signal,
  strictRange,
  responseHeader,
}: RangeRequest): Promise<void> {
  const headers: Record<string, string> = {};
  if (Number.isFinite(requestedStart) && Number.isFinite(requestedEnd)) {
    headers.Range = `bytes=${String(requestedStart)}-${String(requestedEnd)}`;
  }

  const request = got.stream(url, {
    headers,
    retry: { limit: 0 },
    throwHttpErrors: false,
    signal,
  });

  const responseState = { checked: false };
  request.once("response", (response: IncomingMessage) => {
    responseState.checked = true;
    const statusCode = response.statusCode ?? 0;

    if (statusCode >= 400) {
      const err = new Error(`Download failed with HTTP ${String(statusCode)}`);
      request.destroy(err);
      return;
    }

    if (strictRange && headers.Range && statusCode !== 206) {
      const err = Object.assign(
        new Error(
          "Server does not support range requests for segmented download.",
        ),
        { code: "RANGE_UNSUPPORTED" },
      );
      request.destroy(err);
      return;
    }

    if (responseHeader) {
      responseHeader(statusCode);
    }
  });

  request.on("data", (chunk: Buffer) => {
    state.downloadedBytes += chunk.length;
  });

  await pipeline(
    request,
    createWriteStream(targetPath, {
      flags: requestedStart > 0 ? "a" : "w",
    }),
  );

  if (!responseState.checked) {
    throw new Error("Download failed before response was received.");
  }
}

async function downloadSingleWithResume({
  url,
  targetPath,
  state,
  metadata,
  settings,
  signal,
}: {
  url: string;
  targetPath: string;
  state: DownloadState;
  metadata: RemoteMetadata;
  settings: DownloadSettings;
  signal: AbortSignal;
}): Promise<void> {
  let existingBytes = 0;
  if (settings.enableResume) {
    existingBytes = (await stat(targetPath).catch(() => null))?.size || 0;
  }

  state.downloadedBytes = existingBytes;

  const canRangeResume = metadata.acceptRanges && metadata.size > 0;
  const shouldRangeResume =
    settings.enableResume && existingBytes > 0 && canRangeResume;
  const start = shouldRangeResume ? existingBytes : 0;
  const end = metadata.size > 0 ? metadata.size - 1 : Number.NaN;

  await streamSingleRange({
    url,
    targetPath,
    requestedStart: shouldRangeResume ? start : Number.NaN,
    requestedEnd: shouldRangeResume ? end : Number.NaN,
    state,
    signal,
    strictRange: shouldRangeResume,
    responseHeader: (statusCode) => {
      if (shouldRangeResume && statusCode !== 206) {
        void rm(targetPath, { force: true }).catch(() => undefined);
      }
    },
  });
}

async function mergeSegmentParts(
  partPaths: string[],
  targetPath: string,
): Promise<void> {
  for (const [index, sourcePath] of partPaths.entries()) {
    await pipeline(
      createReadStream(sourcePath),
      createWriteStream(targetPath, {
        flags: index === 0 ? "w" : "a",
      }),
    );
  }
}

async function downloadSegmentWithRetry({
  url,
  segment,
  targetPath,
  settings,
  state,
  signal,
}: {
  url: string;
  segment: Segment;
  targetPath: string;
  settings: DownloadSettings;
  state: DownloadState;
  signal: AbortSignal;
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
      const existingBytes = settings.enableResume
        ? (await stat(partPath).catch(() => null))?.size || 0
        : 0;

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
      });

      return partPath;
    } catch (error) {
      if (getErrorProperty(error, "name") === "AbortError") {
        throw error;
      }

      if (getErrorProperty(error, "code") === "RANGE_UNSUPPORTED") {
        throw error;
      }

      if (
        settings.maxRetries !== UNLIMITED_RETRIES &&
        attempt >= settings.maxRetries
      ) {
        throw error;
      }

      const delayMs =
        RETRY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 500);
      await sleepWithSignal(delayMs, signal);
    }
  }

  throw new Error("Segment download failed.");
}

export async function downloadWithSegmentedManager({
  url,
  targetPath,
  signal,
  settings,
  state,
  metadata,
}: {
  url: string;
  targetPath: string;
  signal: AbortSignal;
  settings: DownloadSettings;
  state: DownloadState;
  metadata: RemoteMetadata;
}): Promise<void> {
  const canUseSegments =
    settings.enableMultithread &&
    settings.threadCount > 1 &&
    metadata.acceptRanges &&
    metadata.size > 0;

  if (!canUseSegments) {
    await downloadSingleWithResume({
      url,
      targetPath,
      state,
      metadata,
      settings,
      signal,
    });
    return;
  }

  const segments = buildSegments(metadata.size, settings.threadCount);
  const partPaths = await Promise.all(
    segments.map((segment) =>
      downloadSegmentWithRetry({
        url,
        segment,
        targetPath,
        settings,
        state,
        signal,
      }),
    ),
  );

  await mergeSegmentParts(partPaths, targetPath);

  await Promise.all(
    partPaths.map((partPath) =>
      rm(partPath, { force: true }).catch(() => undefined),
    ),
  );

  const finishedStat = await stat(targetPath).catch(() => null);
  if (!finishedStat?.isFile()) {
    throw new Error("Download did not produce a file.");
  }

  state.downloadedBytes = finishedStat.size;
}
