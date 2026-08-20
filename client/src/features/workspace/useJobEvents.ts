import { useCallback, type Dispatch, type SetStateAction } from "react";
import { openJobSocket } from "../../lib/jobSocket";
import { jobPayloadSchema, type JobPayload } from "./sessionSchemas";
import type { JobTransport } from "./useJobTransport";

type JobEventsContext = Pick<
  JobTransport,
  "closeJobEvents" | "jobSocketRef" | "latestJobIdRef"
> & {
  handleJobSnapshot: (payload: JobPayload, nextUrl: string) => Promise<void>;
  setError: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  startJobPolling: (jobId: string, nextUrl: string) => void;
};

function reportRealtimeError(context: JobEventsContext, message: string) {
  context.setError(message);
  context.setIsLoading(false);
}

function attachJobSocket(
  context: JobEventsContext,
  jobId: string,
  nextUrl: string,
) {
  context.closeJobEvents();
  const socket = openJobSocket(jobId, {
    onJob: (rawPayload) => {
      const parsed = jobPayloadSchema.safeParse(rawPayload);
      if (!parsed.success) {
        reportRealtimeError(context, "Realtime update failed.");
        return;
      }
      void context
        .handleJobSnapshot(parsed.data, nextUrl)
        .catch((error: unknown) => {
          reportRealtimeError(
            context,
            error instanceof Error ? error.message : "Job failed",
          );
        });
    },
    onMalformedPayload: () => {
      reportRealtimeError(context, "Realtime update failed.");
    },
    onSocketError: () => {
      context.closeJobEvents();
      context.startJobPolling(jobId, nextUrl);
    },
    onSocketClose: () => {
      if (context.latestJobIdRef.current === jobId) {
        context.startJobPolling(jobId, nextUrl);
      }
    },
  });
  context.jobSocketRef.current = socket;
}

export function useJobEvents(context: JobEventsContext) {
  return useCallback(
    (jobId: string, nextUrl: string) =>
      attachJobSocket(context, jobId, nextUrl),
    [context],
  );
}
