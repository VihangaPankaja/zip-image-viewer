import type { DownloadOptions } from "../types/download";

export const STRIP_THUMB_SIZE = 220;

export const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "date-asc", label: "Date oldest" },
  { value: "date-desc", label: "Date newest" },
  { value: "natural-tail", label: "Number trail" },
];

export const PREVIEW_QUALITY_OPTIONS = [
  { value: "low", label: "Low preview" },
  { value: "balanced", label: "Balanced preview" },
  { value: "high", label: "High preview" },
];

export const SLIDESHOW_FIT_OPTIONS = [
  { value: "best-fit", label: "Best fit" },
  { value: "fit-width", label: "Fit width" },
  { value: "fit-height", label: "Fit height" },
];

export const DOWNLOAD_THREAD_MODE_OPTIONS = [
  { value: "auto", label: "Auto (recommended)" },
  { value: "single", label: "Single stream" },
  { value: "segmented", label: "Segmented" },
];

export const DOWNLOAD_RETRY_OPTIONS = [
  { value: 0, label: "No retry" },
  { value: 3, label: "3 retries" },
  { value: 5, label: "5 retries" },
  { value: 8, label: "8 retries" },
  { value: -1, label: "Unlimited" },
];

export const VIDEO_TRANSCODE_QUALITY_OPTIONS = [
  { value: "720p", label: "720p (default)" },
  { value: "480p", label: "480p" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "2160p", label: "2160p" },
  { value: "360p", label: "360p" },
  { value: "source", label: "Original source" },
];

export const WORKSPACE_TABS: Array<{
  value: "download" | "preview" | "explorer";
  label: string;
}> = [
  { value: "download", label: "Download" },
  { value: "preview", label: "Preview" },
  { value: "explorer", label: "Explorer" },
];

export const DEFAULT_DOWNLOAD_SETTINGS = {
  threadMode: "auto",
  threadCount: 3,
  enableMultithread: true,
  enableResume: true,
  maxRetries: 3,
  videoQuality: "720p",
};

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  transport: {
    mode: "auto",
    threads: 3,
    multithread: true,
    resume: true,
  },
  retry: {
    maxRetries: 3,
    timeoutMs: 30000,
  },
  media: {
    videoQuality: "720p",
  },
  extraction: {
    enabled: true,
  },
  request: {
    headers: {},
  },
};
