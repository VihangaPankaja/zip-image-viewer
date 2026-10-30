import { useEffect, useState } from "react";
import { readStoredSetting, writeStoredSetting } from "./settingsStorage";
import { SORT_OPTIONS, PREVIEW_QUALITY_OPTIONS } from "../../lib/appConstants";
import type { WorkspaceView } from "./components/WorkspaceAppBar";
import type { JobPayload, OversizePrompt, SessionPayload } from "./sessionSchemas";
import { readWorkspaceLocation } from "./workspaceLocation";
import type { WorkspaceLocation } from "../../../../shared/contracts";

function readSortMode() {
  const stored = readStoredSetting("zip-explorer-sort");
  return SORT_OPTIONS.find(({ value }) => value === stored)?.value ?? "natural-tail";
}

function readPreviewQuality() {
  const stored = readStoredSetting("zip-preview-quality");
  return PREVIEW_QUALITY_OPTIONS.find(({ value }) => value === stored)?.value ?? "balanced";
}

function useWorkspaceRouteState() {
  const [initialLocation] = useState(() => readWorkspaceLocation(window.location.hash));
  const [navigationSessionId, setNavigationSessionId] = useState(initialLocation.sessionId);
  const [livePreview, setLivePreview] = useState(initialLocation.live ?? null);
  const [parents, setParents] = useState(initialLocation.parents);
  const [search, setSearch] = useState(initialLocation.search);
  const [mediaType, setMediaType] = useState<WorkspaceLocation["media"]>(initialLocation.media);
  const [activeView, setActiveView] = useState<WorkspaceView>(initialLocation.view);
  const [selectedPath, setSelectedPath] = useState(initialLocation.path);
  const [sortMode, setSortMode] = useState(() =>
    window.location.hash ? initialLocation.sort : readSortMode(),
  );
  return {
    livePreview,
    setLivePreview,
    navigationSessionId,
    setNavigationSessionId,
    parents,
    setParents,
    search,
    setSearch,
    mediaType,
    setMediaType,
    activeView,
    setActiveView,
    selectedPath,
    setSelectedPath,
    sortMode,
    setSortMode,
  };
}

export function useWorkspacePageState() {
  const navigation = useWorkspaceRouteState();
  const [helpOpen, setHelpOpen] = useState(false);
  const [zipUrl, setZipUrl] = useState("");
  const [mobilePane, setMobilePane] = useState<"files" | "preview">("files");
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
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
    writeStoredSetting("zip-explorer-sort", navigation.sortMode);
  }, [navigation.sortMode]);
  useEffect(() => {
    writeStoredSetting("zip-preview-quality", previewQuality);
  }, [previewQuality]);

  return {
    ...navigation,
    helpOpen,
    setHelpOpen,
    activeJob,
    mobilePane,
    setMobilePane,
    downloadDialogOpen,
    error,
    explorerModalOpen,
    isLoading,
    previewQuality,
    session,
    settingsOpen,
    setActiveJob,
    setDownloadDialogOpen,
    setError,
    setExplorerModalOpen,
    setIsLoading,
    setOversizePrompt,
    setPreviewQuality,
    setSession,
    setSettingsOpen,
    setSlideshowChromeHidden,
    setSlideshowFitMode,
    setSlideshowOpen,
    setZipUrl,
    slideshowChromeHidden,
    slideshowFitMode,
    slideshowOpen,
    zipUrl,
  };
}

export type WorkspacePageState = ReturnType<typeof useWorkspacePageState>;
