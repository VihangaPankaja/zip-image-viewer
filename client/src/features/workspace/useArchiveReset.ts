import { useCallback, type Dispatch, type SetStateAction } from "react";
import type {
  JobPayload,
  OversizePrompt,
  SessionPayload,
} from "./sessionSchemas";

type ArchiveResetParams = {
  clearImagePreviewCache: () => void;
  clearTextPreviewCache: () => void;
  resetSelectedImageSrc: () => void;
  resetTextPreview: () => void;
  setActiveJob: Dispatch<SetStateAction<JobPayload | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setOversizePrompt: Dispatch<SetStateAction<OversizePrompt | null>>;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setSession: Dispatch<SetStateAction<SessionPayload | null>>;
  setSlideshowOpen: Dispatch<SetStateAction<boolean>>;
};

export function useArchiveReset(params: ArchiveResetParams) {
  const {
    clearImagePreviewCache,
    clearTextPreviewCache,
    resetSelectedImageSrc,
    resetTextPreview,
    setActiveJob,
    setIsLoading,
    setOversizePrompt,
    setSelectedPath,
    setSession,
    setSlideshowOpen,
  } = params;
  return useCallback(() => {
    setSession(null);
    setActiveJob(null);
    setSelectedPath("");
    resetTextPreview();
    resetSelectedImageSrc();
    setOversizePrompt(null);
    setSlideshowOpen(false);
    setIsLoading(false);
    clearTextPreviewCache();
    clearImagePreviewCache();
  }, [
    clearImagePreviewCache,
    clearTextPreviewCache,
    resetSelectedImageSrc,
    resetTextPreview,
    setActiveJob,
    setIsLoading,
    setOversizePrompt,
    setSelectedPath,
    setSession,
    setSlideshowOpen,
  ]);
}
