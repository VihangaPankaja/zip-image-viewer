import { useCallback, useEffect, type MutableRefObject } from "react";

type ArchiveCleanupParams = {
  clearImagePreviewCache: () => void;
  clearTextPreviewCache: () => void;
  closeJobEvents: () => void;
  latestJobIdRef: MutableRefObject<string>;
  latestSessionIdRef: MutableRefObject<string>;
  resetArchiveView: () => void;
  resetHydration: () => void;
  stopJobPolling: () => void;
};

export function useArchiveCleanup({
  clearImagePreviewCache,
  clearTextPreviewCache,
  closeJobEvents,
  latestJobIdRef,
  latestSessionIdRef,
  resetArchiveView,
  resetHydration,
  stopJobPolling,
}: ArchiveCleanupParams) {
  const clearArchive = useCallback(
    async (removeRemoteSession = true) => {
      const sessionId = latestSessionIdRef.current;
      const jobId = latestJobIdRef.current;
      closeJobEvents();
      stopJobPolling();
      latestSessionIdRef.current = "";
      latestJobIdRef.current = "";
      resetHydration();
      resetArchiveView();
      if (removeRemoteSession && sessionId) {
        await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" }).catch(
          () => {},
        );
      }
      if (jobId)
        await fetch(`/api/session-jobs/${jobId}`, { method: "DELETE" }).catch(
          () => {},
        );
    },
    [
      closeJobEvents,
      latestJobIdRef,
      latestSessionIdRef,
      resetArchiveView,
      resetHydration,
      stopJobPolling,
    ],
  );

  useEffect(
    () => () => {
      closeJobEvents();
      stopJobPolling();
      clearImagePreviewCache();
      clearTextPreviewCache();
      const sessionId = latestSessionIdRef.current;
      const jobId = latestJobIdRef.current;
      if (sessionId)
        void fetch(`/api/sessions/${sessionId}`, {
          method: "DELETE",
          keepalive: true,
        });
      if (jobId)
        void fetch(`/api/session-jobs/${jobId}`, {
          method: "DELETE",
          keepalive: true,
        });
    },
    [
      clearImagePreviewCache,
      clearTextPreviewCache,
      closeJobEvents,
      latestJobIdRef,
      latestSessionIdRef,
      stopJobPolling,
    ],
  );
  return clearArchive;
}
