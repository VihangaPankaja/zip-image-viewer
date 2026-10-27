import type { IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
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
  responseHeader?: (_response: IncomingMessage, _encoded: boolean) => void;
  checkStorage: (_receivedBytes: number) => void;
  maxBytes: number;
  validator: string;
  totalSize: number;
  resolvedUrl?: string;
  file: HttpFileCheckpoint;
  save: () => void;
};

export async function streamSingleRange(input: RangeRequest): Promise<void> {
  const {
    url,
    targetPath,
    requestedStart,
    requestedEnd,
    state,
    signal,
    responseHeader,
    maxBytes,
    validator,
    file,
    save,
  } = input;
  const headers: Record<string, string> = { "accept-encoding": "identity" };
  if (Number.isFinite(requestedStart) && Number.isFinite(requestedEnd)) {
    if (validator) headers["If-Range"] = validator;
    headers.Range = `bytes=${String(requestedStart)}-${String(requestedEnd)}`;
  }

  const output = await checkpointWriter(targetPath, file, save);
  const request = createRangeRequest(url, headers, signal);

  const responseState = { checked: false };
  let allowedBytes = maxBytes;
  let responseFailure: unknown;
  let expectedLength: number | undefined;
  let htmlContentType = "";
  request.once("response", (response: IncomingMessage) => {
    responseState.checked = true;
    try {
      const { encoded, length } = validateStreamResponse(response, input, Boolean(headers.Range));
      expectedLength = length;
      if (!headers.Range) allowedBytes = expectedLength ?? MAX_RESOURCE_BYTES;
      htmlContentType =
        /text\/html|application\/xhtml\+xml/i.test(response.headers["content-type"] ?? "") &&
        !/\.html?$/i.test(new URL(url).pathname) &&
        !/^attachment\b/i.test(response.headers["content-disposition"] ?? "")
          ? (response.headers["content-type"] ?? "")
          : "";
      responseHeader?.(response, encoded);
    } catch (error) {
      responseFailure = error;
      request.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });

  const initialBytes = file.bytes;
  const received = { downloadedBytes: 0 };
  const budget = createRangeBudget(input, received, () => allowedBytes, Boolean(headers.Range));

  try {
    await pipeline(
      request,
      htmlGuard(() => htmlContentType),
      budget,
      output,
      { signal },
    );
  } catch (error) {
    throw responseFailure ?? error;
  } finally {
    state.downloadedBytes += file.bytes - initialBytes - received.downloadedBytes;
  }
  signal.throwIfAborted();
  if (expectedLength !== undefined && received.downloadedBytes !== expectedLength)
    throw Object.assign(new Error("Download length does not match its response."), {
      code: headers.Range ? "RANGE_UNSUPPORTED" : "DOWNLOAD_FATAL",
    });
  if (headers.Range && file.bytes !== requestedEnd - file.start + 1)
    throw Object.assign(new Error("Download ended before the requested range was complete."), {
      code: "RANGE_UNSUPPORTED",
    });

  if (!responseState.checked) throw new Error("Download failed before response was received.");
}

function createRangeBudget(
  input: RangeRequest,
  received: DownloadState,
  maxBytes: () => number,
  hasRange: boolean,
) {
  return createDownloadBudget(
    () => (hasRange ? MAX_RESOURCE_BYTES : maxBytes()),
    received,
    (bytes) => {
      if (hasRange && bytes > maxBytes())
        throw Object.assign(new Error("Download body exceeds its requested range."), {
          code: "RANGE_UNSUPPORTED",
        });
      input.checkStorage(bytes);
      input.state.downloadedBytes += bytes - received.downloadedBytes;
    },
  );
}

function createRangeRequest(url: string, headers: Record<string, string>, signal: AbortSignal) {
  return got.stream(url, {
    headers,
    retry: { limit: 0 },
    throwHttpErrors: false,
    timeout: {
      lookup: 30_000,
      connect: 30_000,
      secureConnect: 30_000,
      response: 30_000,
      socket: 30_000,
    },
    signal,
    hooks: {
      beforeRedirect: [
        (options) => {
          if (options.url) assertPublicDownloadUrl(options.url);
        },
      ],
    },
  });
}

function validateStreamResponse(response: IncomingMessage, input: RangeRequest, hasRange: boolean) {
  const { encoded } = validateDownloadResponse(response, hasRange, input.strictRange);
  const length = response.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    throw Object.assign(new Error("Invalid download length."), {
      code: hasRange ? "RANGE_UNSUPPORTED" : "DOWNLOAD_FATAL",
    });
  if (hasRange || input.file.bytes > 0) assertRangeResponse(response, input, hasRange);
  return { encoded, length: encoded || length === undefined ? undefined : Number(length) };
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
    (resolvedUrl && response.url && response.url.split("#", 1)[0] !== resolvedUrl.split("#", 1)[0])
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
    if (
      response.headers["content-length"] !== undefined &&
      Number(response.headers["content-length"]) !== requestedEnd - requestedStart + 1
    )
      throw Object.assign(new Error("Download range length changed."), {
        code: "RANGE_UNSUPPORTED",
      });
  }
}

function decodeHtmlPrefix(prefix: Buffer, contentType: string) {
  const bom =
    prefix[0] === 0xff && prefix[1] === 0xfe
      ? "utf-16le"
      : prefix[0] === 0xfe && prefix[1] === 0xff
        ? "utf-16be"
        : prefix.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
          ? "utf-8"
          : "";
  const charset = /\bcharset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(bom || charset || "utf-8").decode(prefix);
  } catch {
    return new TextDecoder("utf-8").decode(prefix);
  }
}

function htmlGuard(contentType: () => string) {
  let prefix = Buffer.alloc(0);
  let checked = false;
  function check() {
    const html = decodeHtmlPrefix(prefix, contentType()).replace(/<!--[\s\S]*?(?:-->|$)/g, "");
    const loginForm = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)(?:<\/form\s*>|$)/gi)].some(
      (form) => /<input\b[^>]*\btype\s*=\s*(?:["']password["']|password(?=[\s>]))/i.test(form[1]),
    );
    if (
      loginForm ||
      /<(?:title|h1)\b[^>]*>\s*(?:access denied|(?:download |signed )?(?:link|request) (?:has )?expired)\b/i.test(
        html,
      )
    )
      throw Object.assign(
        new Error("The origin returned a login or error page. Add a fresh public download link."),
        { code: "DOWNLOAD_LOGIN" },
      );
    checked = true;
  }
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        if (checked || !contentType()) {
          callback(null, chunk);
          return;
        }
        const take = Math.min(8192 - prefix.length, chunk.length);
        prefix = Buffer.concat([prefix, chunk.subarray(0, take)]);
        if (prefix.length === 8192) {
          check();
          this.push(prefix);
          prefix = Buffer.alloc(0);
          callback(null, chunk.subarray(take));
        } else callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error("Invalid download body."));
      }
    },
    flush(callback) {
      try {
        if (prefix.length) {
          check();
          this.push(prefix);
        }
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error("Invalid download body."));
      }
    },
  });
}
