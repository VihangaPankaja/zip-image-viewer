import { useEffect, useState } from "react";
import {
  readDownloadOptions,
  readExplorerColumns,
  readKeyboardSettings,
  type ExplorerColumns,
  type KeyboardSettings,
} from "../features/workspace/settingsStorage";
import type { DownloadOptions } from "../types/download";

export function useLocalStorageSettings() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "dark";
    }

    return window.localStorage.getItem("zip-image-viewer-theme") || "dark";
  });

  const [keyboardSettings, setKeyboardSettings] =
    useState<KeyboardSettings>(readKeyboardSettings);

  const [explorerColumns, setExplorerColumns] =
    useState<ExplorerColumns>(readExplorerColumns);

  const [downloadOptions, setDownloadOptions] =
    useState<DownloadOptions>(readDownloadOptions);

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
