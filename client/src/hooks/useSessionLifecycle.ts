import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { isTerminalJobStatus, wait } from "../lib/archiveUiUtils";
import { openJobSocket } from "../lib/jobSocket";

type SessionTree = {
  path?: string;
};

type SessionPayload = {
  id?: string;
  firstFilePath?: string;
  tree?: SessionTree;
  [key: string]: unknown;
};

type JobPayload = {
  id?: string;
  status?: string;
  sessionId?: string;
  reportedSize?: number;
  error?: string;
  [key: string]: unknown;
};

type UseSessionLifecycleParams = {
  zipUrl: string;
  setZipUrl: Dispatch<SetStateAction<string>>;
  session: SessionPayload | null;
  activeJob: JobPayload | null;
  setSession: Dispatch<SetStateAction<SessionPayload | null>>;
  setActiveJob: Dispatch<SetStateAction<JobPayload | null>>;
  setSelectedPath: Dispatch<SetStateAction<string>>;
  setOversizePrompt: Dispatch<SetStateAction<unknown>>;
  setError: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setSlideshowOpen: Dispatch<SetStateAction<boolean>>;
  setThumbnailStripExpanded: Dispatch<SetStateAction<boolean>>;
  resetTextPreview: () => void;
  resetSelectedImageSrc: () => void;
  clearTextPreviewCache: () => void;
  clearImagePreviewCache: () => void;
  downloadOptions: unknown;
  downloadSettings: unknown;
};

export function useSessionLifecycle({
  zipUrl,
  setZipUrl,
  session,
  activeJob,
  setSession,
  setActiveJob,
  setSelectedPath,
  setOversizePrompt,
  setError,
  setIsLoading,
  setSlideshowOpen,
  setThumbnailStripExpanded,
  resetTextPreview,
  resetSelectedImageSrc,
  clearTextPreviewCache,
  clearImagePreviewCache,
  downloadOptions,
  downloadSettings,
}: UseSessionLifecycleParams) {
  const jobSocketRef = useRef<{ close: () => void } | null>(null);
  const jobPollTimeoutRef = useRef<number | null>(null);
  const latestSessionIdRef = useRef("");
  const latestJobIdRef = useRef("");
  const hydrationRef = useRef<{
    sessionId: string;
    promise: Promise<SessionPayload | null> | null;
  }>({ sessionId: "", promise: null });

  const closeJobEvents = useCallback(() => {
    if (jobSocketRef.current) {
      jobSocketRef.current.close();
      jobSocketRef.current = null;
    }
  }, []);

  const stopJobPolling = useCallback(() => {
    if (jobPollTimeoutRef.current) {
      window.clearTimeout(jobPollTimeoutRef.current);
      jobPollTimeoutRef.current = null;
    }
  }, []);

  const resetArchiveView = useCallback(() => {
    setSession(null);
    setActiveJob(null);
    setSelectedPath("");
    resetTextPreview();
    resetSelectedImageSrc();
    setOversizePrompt(null);
    setSlideshowOpen(false);
    setThumbnailStripExpanded(false);
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
    setThumbnailStripExpanded,
  ]);

  const clearArchive = useCallback(
    async (removeRemoteSession = true) => {
      const activeSessionId = latestSessionIdRef.current;
      const activeJobId = latestJobIdRef.current;

      closeJobEvents();
      stopJobPolling();
      latestSessionIdRef.current = "";
      latestJobIdRef.current = "";
      hydrationRef.current = { sessionId: "", promise: null };
      resetArchiveView();

      if (removeRemoteSession && activeSessionId) {
        await fetch(`/api/sessions/${activeSessionId}`, {
          method: "DELETE",
        }).catch(() => {});
      }

      if (activeJobId) {
        await fetch(`/api/session-jobs/${activeJobId}`, {
          method: "DELETE",
        }).catch(() => {});
      }
    },
    [closeJobEvents, resetArchiveView, stopJobPolling],
  );

  const hydrateSession = useCallback(
    async (sessionId: string, nextUrl: string) => {
      if (!sessionId) {
        return null;
      }

      if (
        hydrationRef.current.sessionId === sessionId &&
        hydrationRef.current.promise
      ) {
        return hydrationRef.current.promise;
      }

      const previousSessionId = latestSessionIdRef.current;
      const request = (async () => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          const response = await fetch(`/api/sessions/${sessionId}/tree`);
          const payload = (await response
            .json()
            .catch(() => ({}))) as SessionPayload;

          if (response.ok) {
            if (previousSessionId && previousSessionId !== sessionId) {
              fetch(`/api/sessions/${previousSessionId}`, {
                method: "DELETE",
              }).catch(() => {});
            }

            latestSessionIdRef.current = payload.id || "";
            setSession(payload);
            setZipUrl(nextUrl);
            setSelectedPath(
              payload.firstFilePath || payload.tree?.path || payload.id || "",
            );
            resetTextPreview();
            resetSelectedImageSrc();
            setOversizePrompt(null);
            setError("");
            clearTextPreviewCache();
            clearImagePreviewCache();
            return payload;
          }

          const message =
            typeof payload.error === "string"
              ? payload.error
              : "Could not open file URL.";
          lastError = new Error(message);

          if (response.status !== 404 || attempt === 2) {
            throw lastError;
          }

          await wait(250 * (attempt + 1));
        }

        throw lastError || new Error("Could not open file URL.");
      })();

      hydrationRef.current = { sessionId, promise: request };

      try {
        return await request;
      } finally {
        if (hydrationRef.current.sessionId === sessionId) {
          hydrationRef.current = { sessionId: "", promise: null };
        }
      }
    },
    [
      clearImagePreviewCache,
      clearTextPreviewCache,
      resetSelectedImageSrc,
      resetTextPreview,
      setError,
      setOversizePrompt,
      setSelectedPath,
      setSession,
      setZipUrl,
    ],
  );

  const handleJobSnapshot = useCallback(
    async (payload: JobPayload, nextUrl: string) => {
      latestJobIdRef.current = payload?.id || "";
      setActiveJob(payload);

      if (payload?.sessionId) {
        await hydrateSession(payload.sessionId, nextUrl);
      }

      if (payload.status === "awaiting_confirmation") {
        setOversizePrompt({
          jobId: payload.id,
          reportedSize: payload.reportedSize,
          limit: 1024 * 1024 * 1024,
        });
        setIsLoading(false);
        return;
      }

      if (payload.status === "ready") {
        closeJobEvents();
        stopJobPolling();
        latestJobIdRef.current = "";
        setOversizePrompt(null);
        setActiveJob(null);
        setIsLoading(false);
        return;
      }

      if (payload.status === "error") {
        closeJobEvents();
        stopJobPolling();
        latestJobIdRef.current = "";
        setActiveJob(null);
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Could not process this file.",
        );
        setIsLoading(false);
        return;
      }

      if (payload.status === "cancelled") {
        closeJobEvents();
        stopJobPolling();
        latestJobIdRef.current = "";
        setActiveJob(null);
        setIsLoading(false);
      }
    },
    [
      closeJobEvents,
      hydrateSession,
      setActiveJob,
      setError,
      setIsLoading,
      setOversizePrompt,
      stopJobPolling,
    ],
  );

  const startJobPolling = useCallback(
    (jobId: string, nextUrl: string) => {
      stopJobPolling();

      async function poll() {
        if (!jobId || latestJobIdRef.current !== jobId) {
          return;
        }

        try {
          const response = await fetch(`/api/session-jobs/${jobId}`);

          if (response.status === 404) {
            stopJobPolling();
            if (!latestSessionIdRef.current) {
              setActiveJob(null);
              setIsLoading(false);
              setError(
                "Archive loading was interrupted before the UI could refresh.",
              );
            }
            return;
          }

          const payload = (await response.json()) as JobPayload;
          await handleJobSnapshot(payload, nextUrl);

          if (
            !isTerminalJobStatus(payload.status) &&
            latestJobIdRef.current === jobId
          ) {
            jobPollTimeoutRef.current = window.setTimeout(poll, 1500);
          }
        } catch {
          if (latestJobIdRef.current === jobId) {
            jobPollTimeoutRef.current = window.setTimeout(poll, 2000);
          }
        }
      }

      jobPollTimeoutRef.current = window.setTimeout(poll, 1500);
    },
    [handleJobSnapshot, setActiveJob, setError, setIsLoading, stopJobPolling],
  );

  const attachJobEvents = useCallback(
    (jobId: string, nextUrl: string) => {
      closeJobEvents();

      const socket = openJobSocket(jobId, {
        onJob: (payload: JobPayload) => {
          handleJobSnapshot(payload, nextUrl).catch((jobError: unknown) => {
            setError(
              jobError instanceof Error ? jobError.message : "Job failed",
            );
            setIsLoading(false);
          });
        },
        onMalformedPayload: () => {
          setError("Realtime update failed.");
          setIsLoading(false);
        },
        onSocketError: () => {
          closeJobEvents();
          startJobPolling(jobId, nextUrl);
        },
        onSocketClose: () => {
          if (!latestJobIdRef.current || latestJobIdRef.current !== jobId) {
            return;
          }

          startJobPolling(jobId, nextUrl);
        },
      });

      jobSocketRef.current = socket;
    },
    [
      closeJobEvents,
      handleJobSnapshot,
      setError,
      setIsLoading,
      startJobPolling,
    ],
  );

  const loadSession = useCallback(
    async (url: string, confirmOversize = false) => {
      setIsLoading(true);
      setError("");
      setOversizePrompt(null);
      setSlideshowOpen(false);
      setThumbnailStripExpanded(false);

      try {
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url,
            confirmOversize,
            downloadOptions,
            downloadSettings,
          }),
        });
        const payload = (await response.json()) as JobPayload;

        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : "Could not open file URL.",
          );
        }

        latestJobIdRef.current = payload.id || "";
        setActiveJob(payload);
        attachJobEvents(payload.id || "", url);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not open file URL.",
        );
        latestJobIdRef.current = "";
        setActiveJob(null);
        stopJobPolling();
        closeJobEvents();
      }
    },
    [
      attachJobEvents,
      closeJobEvents,
      downloadOptions,
      downloadSettings,
      setActiveJob,
      setError,
      setIsLoading,
      setOversizePrompt,
      setSlideshowOpen,
      setThumbnailStripExpanded,
      stopJobPolling,
    ],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!zipUrl.trim()) {
        setError("Paste a public ZIP URL to start browsing.");
        return;
      }
      await loadSession(zipUrl.trim(), false);
    },
    [loadSession, setError, zipUrl],
  );

  useEffect(() => {
    latestSessionIdRef.current = session?.id || "";
  }, [session?.id]);

  useEffect(() => {
    latestJobIdRef.current = activeJob?.id || "";
  }, [activeJob?.id]);

  useEffect(() => {
    return () => {
      closeJobEvents();
      stopJobPolling();
      clearImagePreviewCache();
      clearTextPreviewCache();
      if (latestSessionIdRef.current) {
        fetch(`/api/sessions/${latestSessionIdRef.current}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
      }
      if (latestJobIdRef.current) {
        fetch(`/api/session-jobs/${latestJobIdRef.current}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [
    clearImagePreviewCache,
    clearTextPreviewCache,
    closeJobEvents,
    stopJobPolling,
  ]);

  return {
    clearArchive,
    handleSubmit,
    loadSession,
  };
}
