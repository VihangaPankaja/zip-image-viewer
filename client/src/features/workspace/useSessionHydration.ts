import {
  useCallback,
  useMemo,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { wait } from "../../lib/archiveUiUtils";
import {
  sessionPayloadSchema,
  type OversizePrompt,
  type SessionPayload,
} from "./sessionSchemas";

type HydrationParams = {
  clearImagePreviewCache: () => void;
  clearTextPreviewCache: () => void;
  hydrationRef: RefObject<{
    sessionId: string;
    promise: Promise<SessionPayload | null> | null;
  }>;
  latestSessionIdRef: RefObject<string>;
  resetSelectedImageSrc: () => void;
  resetTextPreview: () => void;
  setError: Dispatch<SetStateAction<string>>;
  setOversizePrompt: Dispatch<SetStateAction<OversizePrompt | null>>;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setSession: Dispatch<SetStateAction<SessionPayload | null>>;
  setZipUrl: Dispatch<SetStateAction<string>>;
};

export function useSessionHydration(params: HydrationParams) {
  const {
    clearImagePreviewCache,
    clearTextPreviewCache,
    hydrationRef,
    latestSessionIdRef,
    resetSelectedImageSrc,
    resetTextPreview,
    setError,
    setOversizePrompt,
    setSelectedPath,
    setSession,
    setZipUrl,
  } = params;
  const stableParams = useMemo(
    () => ({
      clearImagePreviewCache,
      clearTextPreviewCache,
      hydrationRef,
      latestSessionIdRef,
      resetSelectedImageSrc,
      resetTextPreview,
      setError,
      setOversizePrompt,
      setSelectedPath,
      setSession,
      setZipUrl,
    }),
    [
      clearImagePreviewCache,
      clearTextPreviewCache,
      hydrationRef,
      latestSessionIdRef,
      resetSelectedImageSrc,
      resetTextPreview,
      setError,
      setOversizePrompt,
      setSelectedPath,
      setSession,
      setZipUrl,
    ],
  );
  return useCallback(
    (sessionId: string, nextUrl: string) =>
      hydrateSession(stableParams, sessionId, nextUrl),
    [stableParams],
  );
}

async function hydrateSession(
  params: HydrationParams,
  sessionId: string,
  nextUrl: string,
) {
  const { hydrationRef, latestSessionIdRef } = params;
  if (!sessionId) return null;
  if (
    hydrationRef.current.sessionId === sessionId &&
    hydrationRef.current.promise
  )
    return hydrationRef.current.promise;
  const request = requestSession(
    params,
    sessionId,
    nextUrl,
    latestSessionIdRef.current,
  );
  hydrationRef.current = { sessionId, promise: request };
  try {
    return await request;
  } finally {
    if (hydrationRef.current.sessionId === sessionId)
      hydrationRef.current = { sessionId: "", promise: null };
  }
}

async function requestSession(
  params: HydrationParams,
  sessionId: string,
  nextUrl: string,
  previousSessionId: string,
) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`/api/sessions/${sessionId}/tree`);
    const raw: unknown = await response.json().catch(() => ({}));
    const parsed = sessionPayloadSchema.safeParse(raw);
    if (response.ok && parsed.success) {
      applySession(params, parsed.data, nextUrl, previousSessionId);
      return parsed.data;
    }
    lastError = new Error(getSessionError(raw));
    if (response.status !== 404 || attempt === 2) throw lastError;
    await wait(250 * (attempt + 1));
  }
  throw lastError || new Error("Could not open file URL.");
}

function applySession(
  params: HydrationParams,
  payload: SessionPayload,
  nextUrl: string,
  previousSessionId: string,
) {
  if (previousSessionId && previousSessionId !== payload.id)
    void fetch(`/api/sessions/${previousSessionId}`, { method: "DELETE" });
  params.latestSessionIdRef.current = payload.id || "";
  params.setSession(payload);
  params.setZipUrl(nextUrl);
  params.setSelectedPath(
    payload.firstFilePath || payload.tree?.path || payload.id || "",
  );
  params.resetTextPreview();
  params.resetSelectedImageSrc();
  params.setOversizePrompt(null);
  params.setError("");
  params.clearTextPreviewCache();
  params.clearImagePreviewCache();
}

function getSessionError(raw: unknown) {
  return raw &&
    typeof raw === "object" &&
    "error" in raw &&
    typeof raw.error === "string"
    ? raw.error
    : "Could not open file URL.";
}
