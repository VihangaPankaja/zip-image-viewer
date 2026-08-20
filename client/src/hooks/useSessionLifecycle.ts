import type { Dispatch, SetStateAction } from "react";
import type {
  JobPayload,
  OversizePrompt,
  SessionPayload,
} from "../features/workspace/sessionSchemas";
import { useArchiveCleanup } from "../features/workspace/useArchiveCleanup";
import { useArchiveReset } from "../features/workspace/useArchiveReset";
import { useJobEvents } from "../features/workspace/useJobEvents";
import { useJobPolling } from "../features/workspace/useJobPolling";
import { useJobSnapshot } from "../features/workspace/useJobSnapshot";
import { useJobTransport } from "../features/workspace/useJobTransport";
import { useSessionHydration } from "../features/workspace/useSessionHydration";
import { useSessionRequest } from "../features/workspace/useSessionRequest";
export type {
  JobPayload,
  SessionPayload,
} from "../features/workspace/sessionSchemas";

type UseSessionLifecycleParams = {
  zipUrl: string;
  setZipUrl: Dispatch<SetStateAction<string>>;
  session: SessionPayload | null;
  activeJob: JobPayload | null;
  setSession: Dispatch<SetStateAction<SessionPayload | null>>;
  setActiveJob: Dispatch<SetStateAction<JobPayload | null>>;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setOversizePrompt: Dispatch<SetStateAction<OversizePrompt | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setSlideshowOpen: Dispatch<SetStateAction<boolean>>;
  resetTextPreview: () => void;
  resetSelectedImageSrc: () => void;
  clearTextPreviewCache: () => void;
  clearImagePreviewCache: () => void;
  downloadOptions: unknown;
  downloadSettings: unknown;
};

export function useSessionLifecycle(params: UseSessionLifecycleParams) {
  const transport = useJobTransport(params.session?.id, params.activeJob?.id);
  const resetArchiveView = useArchiveReset({ ...params });
  const clearArchive = useArchiveCleanup({
    ...params,
    ...transport,
    resetArchiveView,
  });
  const hydrateSession = useSessionHydration({ ...params, ...transport });
  const handleJobSnapshot = useJobSnapshot({
    ...params,
    ...transport,
    hydrateSession,
  });
  const startJobPolling = useJobPolling({
    ...params,
    ...transport,
    handleJobSnapshot,
  });
  const attachJobEvents = useJobEvents({
    ...params,
    ...transport,
    handleJobSnapshot,
    startJobPolling,
  });
  const request = useSessionRequest(
    { ...params, ...transport, attachJobEvents },
    params.zipUrl,
  );
  return { clearArchive, ...request };
}
