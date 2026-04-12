import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DEFAULT_DOWNLOAD_SETTINGS,
  VIDEO_TRANSCODE_QUALITY_OPTIONS,
} from "./appConstants";
import type { DownloadOptions } from "../types/download";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
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

export function normalizeDownloadSettings(value: unknown) {
  const source = asRecord(value);
  const threadMode =
    source.threadMode === "auto" ||
    source.threadMode === "single" ||
    source.threadMode === "segmented"
      ? source.threadMode
      : DEFAULT_DOWNLOAD_SETTINGS.threadMode;

  return {
    threadMode,
    threadCount: clampNumber(
      String(source.threadCount ?? ""),
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
    maxRetries:
      Number.parseInt(String(source.maxRetries), 10) === -1
        ? -1
        : clampNumber(
        String(source.maxRetries ?? ""),
            0,
            8,
            DEFAULT_DOWNLOAD_SETTINGS.maxRetries,
          ),
    videoQuality: VIDEO_TRANSCODE_QUALITY_OPTIONS.some(
      (option) =>
        option.value === String(source.videoQuality || "").toLowerCase(),
    )
      ? String(source.videoQuality).toLowerCase()
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
    String(retrySource.timeoutMs ?? ""),
    5000,
    180000,
    30000,
  );
  const headers =
    requestSource.headers && typeof requestSource.headers === "object"
      ? Object.fromEntries(
          Object.entries(requestSource.headers as Record<string, unknown>)
            .filter(([key, val]) => key && val != null)
            .map(([key, val]) => [String(key), String(val)]),
        )
      : {};

  return {
    transport: {
      mode:
        (transportSource.mode === "single" ||
        transportSource.mode === "segmented" ||
        transportSource.mode === "auto"
          ? transportSource.mode
          : legacy.threadMode) as DownloadOptions["transport"]["mode"],
      threads: clampNumber(
        String(transportSource.threads ?? ""),
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
      maxRetries:
        Number.parseInt(String(retrySource.maxRetries), 10) === -1
          ? -1
          : clampNumber(
              String(retrySource.maxRetries ?? ""),
              0,
              8,
              legacy.maxRetries,
            ),
      timeoutMs,
    },
    media: {
      videoQuality: VIDEO_TRANSCODE_QUALITY_OPTIONS.some(
        (option) =>
          option.value === String(mediaSource.videoQuality || "").toLowerCase(),
      )
        ? String(mediaSource.videoQuality).toLowerCase()
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
