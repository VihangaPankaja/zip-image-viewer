import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DEFAULT_DOWNLOAD_SETTINGS,
  VIDEO_TRANSCODE_QUALITY_OPTIONS,
  type DownloadSettings,
} from "./appConstants";
import type { DownloadOptions } from "../types/download";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function asInputText(value: unknown): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : "";
}

function isThreadMode(value: unknown): value is DownloadSettings["threadMode"] {
  return value === "auto" || value === "single" || value === "segmented";
}

function normalizeRequestHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, entry]) =>
          key.length > 0 &&
          (typeof entry === "string" ||
            typeof entry === "number" ||
            typeof entry === "boolean"),
      )
      .map(([key, entry]) => [key, asInputText(entry)]),
  );
}

function normalizeRetryCount(value: unknown, fallback: number): number {
  return Number.parseInt(asInputText(value), 10) === -1
    ? -1
    : clampNumber(asInputText(value), 0, 8, fallback);
}

export function clampNumber(
  value: string | number,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeDownloadSettings(value: unknown): DownloadSettings {
  const source = asRecord(value);
  const threadMode = isThreadMode(source.threadMode)
    ? source.threadMode
    : DEFAULT_DOWNLOAD_SETTINGS.threadMode;

  return {
    threadMode,
    threadCount: clampNumber(
      asInputText(source.threadCount),
      1,
      8,
      DEFAULT_DOWNLOAD_SETTINGS.threadCount,
    ),
    enableMultithread:
      source.enableMultithread == null
        ? DEFAULT_DOWNLOAD_SETTINGS.enableMultithread
        : Boolean(source.enableMultithread),
    enableResume:
      source.enableResume == null
        ? DEFAULT_DOWNLOAD_SETTINGS.enableResume
        : Boolean(source.enableResume),
    maxRetries: normalizeRetryCount(
      source.maxRetries,
      DEFAULT_DOWNLOAD_SETTINGS.maxRetries,
    ),
    videoQuality: VIDEO_TRANSCODE_QUALITY_OPTIONS.some(
      (option) =>
        option.value === asInputText(source.videoQuality).toLowerCase(),
    )
      ? asInputText(source.videoQuality).toLowerCase()
      : DEFAULT_DOWNLOAD_SETTINGS.videoQuality,
  };
}

export function normalizeDownloadOptions(value: unknown): DownloadOptions {
  const source = asRecord(value);
  const transportSource = asRecord(source.transport);
  const retrySource = asRecord(source.retry);
  const mediaSource = asRecord(source.media);
  const extractionSource = asRecord(source.extraction);
  const requestSource = asRecord(source.request);

  const legacy = normalizeDownloadSettings(source);
  const timeoutMs = clampNumber(
    asInputText(retrySource.timeoutMs),
    5000,
    180000,
    30000,
  );
  const headers = normalizeRequestHeaders(requestSource.headers);

  return {
    transport: {
      mode:
        transportSource.mode === "single" ||
        transportSource.mode === "segmented" ||
        transportSource.mode === "auto"
          ? transportSource.mode
          : legacy.threadMode,
      threads: clampNumber(
        asInputText(transportSource.threads),
        1,
        8,
        legacy.threadCount,
      ),
      multithread:
        transportSource.multithread == null
          ? legacy.enableMultithread
          : Boolean(transportSource.multithread),
      resume:
        transportSource.resume == null
          ? legacy.enableResume
          : Boolean(transportSource.resume),
    },
    retry: {
      maxRetries: normalizeRetryCount(
        retrySource.maxRetries,
        legacy.maxRetries,
      ),
      timeoutMs,
    },
    media: {
      videoQuality: VIDEO_TRANSCODE_QUALITY_OPTIONS.some(
        (option) =>
          option.value === asInputText(mediaSource.videoQuality).toLowerCase(),
      )
        ? asInputText(mediaSource.videoQuality).toLowerCase()
        : legacy.videoQuality,
    },
    extraction: {
      enabled:
        extractionSource.enabled == null
          ? DEFAULT_DOWNLOAD_OPTIONS.extraction.enabled
          : Boolean(extractionSource.enabled),
    },
    request: {
      headers,
    },
  };
}

export function downloadOptionsToLegacySettings(options: DownloadOptions) {
  return {
    threadMode: options.transport.mode,
    threadCount: options.transport.threads,
    enableMultithread: options.transport.multithread,
    enableResume: options.transport.resume,
    maxRetries: options.retry.maxRetries,
    videoQuality: options.media.videoQuality,
  };
}
