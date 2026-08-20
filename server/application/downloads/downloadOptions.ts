import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DEFAULT_DOWNLOAD_SETTINGS,
} from "../../config/runtimeConstants.js";
import type { DownloadOptions, ThreadMode } from "../../domain/models.js";

const MAX_THREAD_COUNT = 8;
const MAX_RETRIES = 8;
const UNLIMITED_RETRIES = -1;
const VIDEO_QUALITIES = new Set([
  "source",
  "360p",
  "480p",
  "720p",
  "1080p",
  "1440p",
  "2160p",
]);

export type DownloadSettings = {
  threadMode: ThreadMode;
  threadCount: number;
  enableMultithread: boolean;
  enableResume: boolean;
  maxRetries: number;
  videoQuality: string;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function integer(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function threadMode(value: unknown): ThreadMode {
  return value === "single" || value === "segmented" || value === "auto"
    ? value
    : "auto";
}

function retryCount(value: unknown, fallback: number): number {
  const parsed = integer(value, fallback);
  return parsed === UNLIMITED_RETRIES
    ? parsed
    : Math.max(0, Math.min(MAX_RETRIES, parsed));
}

function videoQuality(value: unknown, fallback: string): string {
  const quality = text(value).toLowerCase();
  return VIDEO_QUALITIES.has(quality) ? quality : fallback;
}

export function normalizeDownloadSettings(input: unknown): DownloadSettings {
  const source = record(input);
  return {
    threadMode: threadMode(source.threadMode),
    threadCount: Math.max(
      1,
      Math.min(
        MAX_THREAD_COUNT,
        integer(source.threadCount, DEFAULT_DOWNLOAD_SETTINGS.threadCount),
      ),
    ),
    enableMultithread:
      source.enableMultithread === undefined
        ? DEFAULT_DOWNLOAD_SETTINGS.enableMultithread
        : Boolean(source.enableMultithread),
    enableResume:
      source.enableResume === undefined
        ? DEFAULT_DOWNLOAD_SETTINGS.enableResume
        : Boolean(source.enableResume),
    maxRetries: retryCount(
      source.maxRetries,
      DEFAULT_DOWNLOAD_SETTINGS.maxRetries,
    ),
    videoQuality: videoQuality(source.videoQuality, "720p"),
  };
}

export function normalizeDownloadOptions(input: unknown): DownloadOptions {
  const source = record(input);
  const flat = normalizeDownloadSettings(source);
  const transport = record(source.transport);
  const retry = record(source.retry);
  const media = record(source.media);
  const extraction = record(source.extraction);
  const request = record(source.request);
  const headers = record(request.headers);

  return {
    transport: {
      mode: threadMode(transport.mode ?? flat.threadMode),
      threads: Math.max(
        1,
        Math.min(
          MAX_THREAD_COUNT,
          integer(transport.threads, flat.threadCount),
        ),
      ),
      multithread:
        transport.multithread === undefined
          ? flat.enableMultithread
          : Boolean(transport.multithread),
      resume:
        transport.resume === undefined
          ? flat.enableResume
          : Boolean(transport.resume),
    },
    retry: {
      maxRetries: retryCount(retry.maxRetries, flat.maxRetries),
      timeoutMs: Math.max(
        5_000,
        Math.min(180_000, integer(retry.timeoutMs, 30_000)),
      ),
    },
    media: {
      videoQuality: videoQuality(
        media.videoQuality ?? flat.videoQuality,
        DEFAULT_DOWNLOAD_OPTIONS.media.videoQuality,
      ),
    },
    extraction: {
      enabled:
        extraction.enabled === undefined
          ? DEFAULT_DOWNLOAD_OPTIONS.extraction.enabled
          : Boolean(extraction.enabled),
    },
    request: {
      headers: Object.fromEntries(
        Object.entries(headers).flatMap(([key, value]) => {
          const headerValue = text(value);
          return key && headerValue ? [[key, headerValue]] : [];
        }),
      ),
    },
  };
}

export function downloadOptionsToSettings(
  options: DownloadOptions,
): DownloadSettings {
  return {
    threadMode: options.transport.mode,
    threadCount: options.transport.threads,
    enableMultithread: options.transport.multithread,
    enableResume: options.transport.resume,
    maxRetries: options.retry.maxRetries,
    videoQuality: options.media.videoQuality,
  };
}
