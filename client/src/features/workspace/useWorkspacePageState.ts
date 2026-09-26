import { useEffect, useState } from "react";
import { readStoredSetting, writeStoredSetting } from "./settingsStorage";
import { SORT_OPTIONS, PREVIEW_QUALITY_OPTIONS } from "../../lib/appConstants";
import type { WorkspaceView } from "./components/WorkspaceAppBar";
import type {
  JobPayload,
  OversizePrompt,
  SessionPayload,
} from "./sessionSchemas";

function readSortMode() {
  const stored = readStoredSetting("zip-explorer-sort");
  return (
    SORT_OPTIONS.find(({ value }) => value === stored)?.value ?? "natural-tail"
  );
}

function readPreviewQuality() {
  const stored = readStoredSetting("zip-preview-quality");
  return (
    PREVIEW_QUALITY_OPTIONS.find(({ value }) => value === stored)?.value ??
    "balanced"
  );
}

export function useWorkspacePageState() {
  const [zipUrl, setZipUrl] = useState("");
  const [activeView, setActiveView] = useState<WorkspaceView>("downloads");
  const [mobilePane, setMobilePane] = useState<"files" | "preview">("files");
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [sortMode, setSortMode] = useState(readSortMode);
  const [previewQuality, setPreviewQuality] = useState(readPreviewQuality);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [, setOversizePrompt] = useState<OversizePrompt | null>(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [explorerModalOpen, setExplorerModalOpen] = useState(false);
  const [slideshowFitMode, setSlideshowFitMode] = useState("best-fit");
  const [slideshowChromeHidden, setSlideshowChromeHidden] = useState(false);
  const [activeJob, setActiveJob] = useState<JobPayload | null>(null);

  useEffect(() => {
    writeStoredSetting("zip-explorer-sort", sortMode);
  }, [sortMode]);
  useEffect(() => {
    writeStoredSetting("zip-preview-quality", previewQuality);
  }, [previewQuality]);

  return {
    activeJob,
    activeView,
    mobilePane,
    setMobilePane,
    downloadDialogOpen,
    error,
    explorerModalOpen,
    isLoading,
    previewQuality,
    selectedPath,
    session,
    settingsOpen,
    setActiveJob,
    setActiveView,
    setDownloadDialogOpen,
    setError,
    setExplorerModalOpen,
    setIsLoading,
    setOversizePrompt,
    setPreviewQuality,
    setSelectedPath,
    setSession,
    setSettingsOpen,
    setSlideshowChromeHidden,
    setSlideshowFitMode,
    setSlideshowOpen,
    setSortMode,
    setZipUrl,
    slideshowChromeHidden,
    slideshowFitMode,
    slideshowOpen,
    sortMode,
    zipUrl,
  };
}

export type WorkspacePageState = ReturnType<typeof useWorkspacePageState>;
