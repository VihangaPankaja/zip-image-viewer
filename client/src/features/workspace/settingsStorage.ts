import { DEFAULT_DOWNLOAD_OPTIONS } from "../../lib/appConstants";
import {
  clampNumber,
  normalizeDownloadOptions,
} from "../../lib/downloadOptions";
import type { DownloadOptions } from "../../types/download";

export type KeyboardSettings = { jumpSeconds: number; rateStep: number };
export type ExplorerColumns = {
  type: boolean;
  size: boolean;
  date: boolean;
  path: boolean;
};
const defaultKeyboard: KeyboardSettings = { jumpSeconds: 5, rateStep: 0.25 };
const defaultColumns: ExplorerColumns = {
  type: true,
  size: true,
  date: true,
  path: true,
};

function parseStoredValue(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export function readKeyboardSettings(): KeyboardSettings {
  if (typeof window === "undefined") return defaultKeyboard;
  const value = parseStoredValue(
    window.localStorage.getItem("zip-shortcut-settings"),
  );
  const jump = value?.jumpSeconds;
  const rate = value?.rateStep;
  return {
    jumpSeconds: clampNumber(
      typeof jump === "string" || typeof jump === "number" ? jump : 5,
      1,
      30,
      5,
    ),
    rateStep: typeof rate === "number" && rate > 0 ? rate : 0.25,
  };
}
export function readExplorerColumns(): ExplorerColumns {
  if (typeof window === "undefined") return defaultColumns;
  const value = parseStoredValue(
    window.localStorage.getItem("zip-explorer-columns"),
  );
  return {
    type: value?.type !== false,
    size: value?.size !== false,
    date: value?.date !== false,
    path: value?.path !== false,
  };
}
export function readDownloadOptions(): DownloadOptions {
  if (typeof window === "undefined") return DEFAULT_DOWNLOAD_OPTIONS;
  const current = parseStoredValue(
    window.localStorage.getItem("zip-download-options"),
  );
  const legacy = parseStoredValue(
    window.localStorage.getItem("zip-download-settings"),
  );
  return normalizeDownloadOptions(
    current ?? legacy ?? DEFAULT_DOWNLOAD_OPTIONS,
  );
}
