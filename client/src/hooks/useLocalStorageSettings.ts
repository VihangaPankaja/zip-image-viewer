import { useEffect, useState } from "react";
import {
  readDownloadOptions,
  readStoredSetting,
  writeStoredSetting,
  readExplorerColumns,
  readKeyboardSettings,
  type ExplorerColumns,
  type KeyboardSettings,
} from "../features/workspace/settingsStorage";
import type { DownloadOptions } from "../types/download";

export type DarkSurface = "charcoal" | "amoled";

export type ThemePreference = "system" | "light" | "dark";
export type Accent = "teal" | "blue" | "violet" | "amber" | "rose";

export function useLocalStorageSettings() {
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const stored = readStoredSetting("zip-image-viewer-theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  });

  const [darkSurface, setDarkSurface] = useState<DarkSurface>(() =>
    readStoredSetting("zip-image-viewer-dark-surface") === "amoled" ? "amoled" : "charcoal",
  );
  const [accent, setAccent] = useState<Accent>(() => {
    const stored = readStoredSetting("zip-image-viewer-accent");
    return stored === "blue" || stored === "violet" || stored === "amber" || stored === "rose"
      ? stored
      : "teal";
  });
  const [accentSaveError, setAccentSaveError] = useState(false);

  const [keyboardSettings, setKeyboardSettings] = useState<KeyboardSettings>(readKeyboardSettings);

  const [explorerColumns, setExplorerColumns] = useState<ExplorerColumns>(readExplorerColumns);

  const [downloadOptions, setDownloadOptions] = useState<DownloadOptions>(readDownloadOptions);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (preference.matches ? "dark" : "light") : theme;
    };
    applyTheme();
    writeStoredSetting("zip-image-viewer-theme", theme);
    preference.addEventListener("change", applyTheme);
    return () => preference.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.darkSurface = darkSurface;
    writeStoredSetting("zip-image-viewer-dark-surface", darkSurface);
  }, [darkSurface]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    setAccentSaveError(!writeStoredSetting("zip-image-viewer-accent", accent));
  }, [accent]);

  useEffect(() => {
    writeStoredSetting("zip-download-options", JSON.stringify(downloadOptions));
  }, [downloadOptions]);

  useEffect(() => {
    writeStoredSetting("zip-explorer-columns", JSON.stringify(explorerColumns));
  }, [explorerColumns]);

  useEffect(() => {
    writeStoredSetting("zip-shortcut-settings", JSON.stringify(keyboardSettings));
  }, [keyboardSettings]);

  return {
    theme,
    setTheme,
    darkSurface,
    setDarkSurface,
    accent,
    setAccent,
    accentSaveError,
    keyboardSettings,
    setKeyboardSettings,
    explorerColumns,
    setExplorerColumns,
    downloadOptions,
    setDownloadOptions,
  };
}
