import { useCallback, useEffect, useRef } from "react";
import type { SessionPayload } from "./sessionSchemas";

type HydrationRef = {
  sessionId: string;
  promise: Promise<SessionPayload | null> | null;
};

export function useJobTransport(
  sessionId: string | undefined,
  activeJobId: string | undefined,
) {
  const jobSocketRef = useRef<{ close: () => void } | null>(null);
  const jobPollTimeoutRef = useRef<number | null>(null);
  const latestSessionIdRef = useRef("");
  const latestJobIdRef = useRef("");
  const hydrationRef = useRef<HydrationRef>({ sessionId: "", promise: null });

  const closeJobEvents = useCallback(() => {
    jobSocketRef.current?.close();
    jobSocketRef.current = null;
  }, []);
  const stopJobPolling = useCallback(() => {
    if (jobPollTimeoutRef.current !== null) {
      window.clearTimeout(jobPollTimeoutRef.current);
      jobPollTimeoutRef.current = null;
    }
  }, []);
  const resetHydration = useCallback(() => {
    hydrationRef.current = { sessionId: "", promise: null };
  }, []);

  useEffect(() => {
    latestSessionIdRef.current = sessionId ?? "";
  }, [sessionId]);
  useEffect(() => {
    latestJobIdRef.current = activeJobId ?? "";
  }, [activeJobId]);

  return {
    closeJobEvents,
    hydrationRef,
    jobPollTimeoutRef,
    jobSocketRef,
    latestJobIdRef,
    latestSessionIdRef,
    resetHydration,
    stopJobPolling,
  };
}

export type JobTransport = ReturnType<typeof useJobTransport>;
