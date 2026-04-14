import { useEffect, useState } from "react";
import { DEFAULT_DOWNLOAD_OPTIONS } from "../lib/appConstants";
import { clampNumber, normalizeDownloadOptions } from "../lib/downloadOptions";
import type { DownloadOptions } from "../types/download";

type KeyboardSettings = {
  jumpSeconds: number;
  rateStep: number;
};

type ExplorerColumns = {
  type: boolean;
  size: boolean;
  date: boolean;
  path: boolean;
};

export function useLocalStorageSettings() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    return window.localStorage.getItem("zip-image-viewer-theme") || "dark";
  });

  const [keyboardSettings, setKeyboardSettings] = useState<KeyboardSettings>(
    () => {
      if (typeof window === "undefined") {
        return { jumpSeconds: 5, rateStep: 0.25 };
      }

      try {
        const raw = window.localStorage.getItem("zip-shortcut-settings");
        const parsed = raw ? JSON.parse(raw) : null;

        return {
          jumpSeconds: clampNumber(parsed?.jumpSeconds, 1, 30, 5),
          rateStep:
            Number(parsed?.rateStep) > 0 ? Number(parsed.rateStep) : 0.25,
        };
      } catch {
        return { jumpSeconds: 5, rateStep: 0.25 };
      }
    },
  );

  const [explorerColumns, setExplorerColumns] = useState<ExplorerColumns>(
    () => {
      if (typeof window === "undefined") {
        return { type: true, size: true, date: true, path: true };
      }

      try {
        const raw = window.localStorage.getItem("zip-explorer-columns");
        const parsed = raw ? JSON.parse(raw) : null;

        return {
          type: parsed?.type !== false,
          size: parsed?.size !== false,
          date: parsed?.date !== false,
          path: parsed?.path !== false,
        };
      } catch {
        return { type: true, size: true, date: true, path: true };
      }
    },
  );

  const [downloadOptions, setDownloadOptions] = useState<DownloadOptions>(
    () => {
      if (typeof window === "undefined") {
        return DEFAULT_DOWNLOAD_OPTIONS;
      }

      try {
        const raw = window.localStorage.getItem("zip-download-options");
        const legacy = window.localStorage.getItem("zip-download-settings");

        if (raw) {
          return normalizeDownloadOptions(JSON.parse(raw));
        }

        if (legacy) {
          return normalizeDownloadOptions(JSON.parse(legacy));
        }

        return DEFAULT_DOWNLOAD_OPTIONS;
      } catch {
        return DEFAULT_DOWNLOAD_OPTIONS;
      }
    },
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("zip-image-viewer-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(
      "zip-download-options",
      JSON.stringify(downloadOptions),
    );
  }, [downloadOptions]);

  useEffect(() => {
    window.localStorage.setItem(
      "zip-explorer-columns",
      JSON.stringify(explorerColumns),
    );
  }, [explorerColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      "zip-shortcut-settings",
      JSON.stringify(keyboardSettings),
    );
  }, [keyboardSettings]);

  return {
    theme,
    setTheme,
    keyboardSettings,
    setKeyboardSettings,
    explorerColumns,
    setExplorerColumns,
    downloadOptions,
    setDownloadOptions,
  };
}
