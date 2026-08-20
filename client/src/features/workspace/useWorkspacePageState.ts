import { useState } from "react";
import type {
  JobPayload,
  OversizePrompt,
  SessionPayload,
} from "./sessionSchemas";

export function useWorkspacePageState() {
  const [zipUrl, setZipUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [sortMode, setSortMode] = useState("natural-tail");
  const [previewQuality, setPreviewQuality] = useState("balanced");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [, setOversizePrompt] = useState<OversizePrompt | null>(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [explorerModalOpen, setExplorerModalOpen] = useState(false);
  const [slideshowFitMode, setSlideshowFitMode] = useState("best-fit");
  const [slideshowChromeHidden, setSlideshowChromeHidden] = useState(false);
  const [activeJob, setActiveJob] = useState<JobPayload | null>(null);

  return {
    activeJob,
    error,
    explorerModalOpen,
    isLoading,
    previewQuality,
    selectedPath,
    session,
    settingsOpen,
    setActiveJob,
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
