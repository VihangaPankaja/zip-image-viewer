import type { IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";
import got from "got";
import { assertPublicDownloadUrl, validateDownloadResponse } from "./publicDownload.js";
import { checkpointWriter, type HttpFileCheckpoint } from "./httpCheckpoint.js";
import { createDownloadBudget, MAX_RESOURCE_BYTES } from "../runtime/resourceLimits.js";
type DownloadState = { downloadedBytes: number };
type RangeRequest = {
  url: string;
  targetPath: string;
  requestedStart: number;
  requestedEnd: number;
  state: DownloadState;
  signal: AbortSignal;
  strictRange: boolean;
  responseHeader?: (_statusCode: number, _encoded: boolean, _length: number) => void;
  checkStorage: (_receivedBytes: number) => void;
  maxBytes: number;
  validator: string;
  totalSize: number;
  resolvedUrl: string;
  file: HttpFileCheckpoint;
  save: () => void;
};

export async function streamSingleRange({
  url,
  targetPath,
  requestedStart,
  requestedEnd,
  state,
  signal,
  strictRange,
  responseHeader,
  checkStorage,
  maxBytes,
  validator,
  totalSize,
  resolvedUrl,
  file,
  save,
}: RangeRequest): Promise<void> {
  const headers: Record<string, string> = { "accept-encoding": "identity" };
  if (Number.isFinite(requestedStart) && Number.isFinite(requestedEnd)) {
    if (validator) headers["If-Range"] = validator;
    headers.Range = `bytes=${String(requestedStart)}-${String(requestedEnd)}`;
  }

  const request = got.stream(url, {
    headers,
    retry: { limit: 0 },
    throwHttpErrors: false,
    signal,
    hooks: {
      beforeRedirect: [
        (options) => {
          if (options.url) assertPublicDownloadUrl(options.url);
        },
      ],
    },
  });

  const responseState = { checked: false };
  let allowedBytes = maxBytes;
  request.once("response", (response: IncomingMessage) => {
    responseState.checked = true;
    try {
      const { statusCode, encoded } = validateDownloadResponse(
        response,
        Boolean(headers.Range),
        strictRange,
      );
      assertRangeResponse(
        response,
        { requestedStart, requestedEnd, totalSize, validator, resolvedUrl },
        Boolean(headers.Range),
      );
      if (encoded) allowedBytes = MAX_RESOURCE_BYTES;
      responseHeader?.(statusCode, encoded, Number(response.headers["content-length"]) || 0);
    } catch (error) {
      request.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });

  const initialBytes = file.bytes;
  const received = { downloadedBytes: 0 };
  const budget = createDownloadBudget(
    () => allowedBytes,
    received,
    (bytes) => {
      checkStorage(bytes);
      state.downloadedBytes += bytes - received.downloadedBytes;
    },
  );

  try {
    await pipeline(request, budget, await checkpointWriter(targetPath, file, save), { signal });
  } finally {
    state.downloadedBytes += file.bytes - initialBytes - received.downloadedBytes;
  }
  signal.throwIfAborted();
  if (headers.Range && file.bytes !== requestedEnd - file.start + 1)
    throw new Error("Download ended before the requested range was complete.");

  if (!responseState.checked) throw new Error("Download failed before response was received.");
}

function assertRangeResponse(
  response: IncomingMessage,
  input: Pick<
    RangeRequest,
    "requestedStart" | "requestedEnd" | "totalSize" | "validator" | "resolvedUrl"
  >,
  hasRange: boolean,
) {
  const { requestedStart, requestedEnd, totalSize, validator, resolvedUrl } = input;
  if (
    (validator &&
      (validator.startsWith('"') ? response.headers.etag : response.headers["last-modified"]) !==
        validator) ||
    (response.url && response.url.split("#", 1)[0] !== resolvedUrl.split("#", 1)[0])
  )
    throw Object.assign(new Error("Download source identity changed."), {
      code: "SOURCE_CHANGED",
    });
  if (hasRange) {
    const expected = `bytes ${requestedStart}-${requestedEnd}/${totalSize}`;
    if (response.headers["content-range"] !== expected) {
      throw Object.assign(new Error("Download source identity or range changed."), {
        code: "SOURCE_CHANGED",
      });
    }
  }
}
