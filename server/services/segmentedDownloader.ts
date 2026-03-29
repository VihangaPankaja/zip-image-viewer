// @ts-nocheck
import { createReadStream, createWriteStream } from "node:fs";
import { stat, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import got from "got";

const UNLIMITED_RETRIES = -1;
const RETRY_BASE_DELAY_MS = 1200;

function sleepWithSignal(ms, signal) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function buildSegments(totalSize, segmentCount) {
  if (!Number.isFinite(totalSize) || totalSize <= 0 || segmentCount <= 1) {
    return [];
  }

  const safeCount = Math.max(1, Math.floor(segmentCount));
  const sizePerSegment = Math.floor(totalSize / safeCount);
  const segments = [];

  let start = 0;
  for (let i = 0; i < safeCount; i += 1) {
    const end = i === safeCount - 1 ? totalSize - 1 : start + sizePerSegment - 1;
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
}) {
  const headers = {};
  if (Number.isFinite(requestedStart) && Number.isFinite(requestedEnd)) {
    headers.Range = `bytes=${requestedStart}-${requestedEnd}`;
  }

  const request = got.stream(url, {
    headers,
    retry: { limit: 0 },
    throwHttpErrors: false,
    signal,
  });

  let responseChecked = false;
  request.once("response", (response) => {
    responseChecked = true;

    if (response.statusCode >= 400) {
      const err = new Error(`Download failed with HTTP ${response.statusCode}`);
      err.statusCode = response.statusCode;
      request.destroy(err);
      return;
    }

    if (strictRange && headers.Range && response.statusCode !== 206) {
      const err = Object.assign(
        new Error("Server does not support range requests for segmented download."),
        { code: "RANGE_UNSUPPORTED" },
      );
      request.destroy(err);
      return;
    }

    if (responseHeader) {
      responseHeader(response.statusCode);
    }
  });

  request.on("data", (chunk) => {
    state.downloadedBytes += chunk.length;
  });

  await pipeline(
    request,
    createWriteStream(targetPath, {
      flags: requestedStart > 0 ? "a" : "w",
    }),
  );

  if (!responseChecked) {
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
}) {
  let existingBytes = 0;
  if (settings.enableResume) {
    existingBytes = (await stat(targetPath).catch(() => null))?.size || 0;
  }

  state.downloadedBytes = existingBytes;

  const canRangeResume = metadata.acceptRanges && metadata.size > 0;
  const shouldRangeResume = settings.enableResume && existingBytes > 0 && canRangeResume;
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
    responseHeader: async (statusCode) => {
      if (shouldRangeResume && statusCode !== 206) {
        await rm(targetPath, { force: true }).catch(() => {});
      }
    },
  });
}

async function mergeSegmentParts(partPaths, targetPath) {
  for (let i = 0; i < partPaths.length; i += 1) {
    const sourcePath = partPaths[i];
    await pipeline(
      createReadStream(sourcePath),
      createWriteStream(targetPath, {
        flags: i === 0 ? "w" : "a",
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
}) {
  const partPath = `${targetPath}.part.${segment.index}`;

  for (
    let attempt = 0;
    settings.maxRetries === UNLIMITED_RETRIES || attempt <= settings.maxRetries;
    attempt += 1
  ) {
    if (signal?.aborted) {
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
      if (error.name === "AbortError") {
        throw error;
      }

      if (error.code === "RANGE_UNSUPPORTED") {
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
}) {
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
    partPaths.map((partPath) => rm(partPath, { force: true }).catch(() => {})),
  );

  const finishedStat = await stat(targetPath).catch(() => null);
  if (!finishedStat?.isFile()) {
    throw new Error("Download did not produce a file.");
  }

  state.downloadedBytes = finishedStat.size;
}
