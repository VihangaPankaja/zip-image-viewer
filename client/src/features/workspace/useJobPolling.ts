import { useCallback, type Dispatch, type SetStateAction } from "react";
import { isTerminalJobStatus } from "../../lib/archiveUiUtils";
import { jobPayloadSchema, type JobPayload } from "./sessionSchemas";
import type { JobTransport } from "./useJobTransport";

type PollContext = Pick<
  JobTransport,
  | "jobPollTimeoutRef"
  | "latestJobIdRef"
  | "latestSessionIdRef"
  | "stopJobPolling"
> & {
  handleJobSnapshot: (payload: JobPayload, nextUrl: string) => Promise<void>;
  setActiveJob: Dispatch<SetStateAction<JobPayload | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
};

function schedulePoll(
  context: PollContext,
  jobId: string,
  nextUrl: string,
  delay: number,
) {
  context.jobPollTimeoutRef.current = window.setTimeout(() => {
    void pollJob(context, jobId, nextUrl);
  }, delay);
}

async function pollJob(context: PollContext, jobId: string, nextUrl: string) {
  if (!jobId || context.latestJobIdRef.current !== jobId) return;
  try {
    const response = await fetch(`/api/session-jobs/${jobId}`);
    if (response.status === 404) {
      context.stopJobPolling();
      if (!context.latestSessionIdRef.current) {
        context.setActiveJob(null);
        context.setIsLoading(false);
        context.setError(
          "Archive loading was interrupted before the UI could refresh.",
        );
      }
      return;
    }
    const parsed = jobPayloadSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Received an invalid job update.");
    await context.handleJobSnapshot(parsed.data, nextUrl);
    if (
      !isTerminalJobStatus(parsed.data.status ?? "") &&
      context.latestJobIdRef.current === jobId
    ) {
      schedulePoll(context, jobId, nextUrl, 1500);
    }
  } catch {
    if (context.latestJobIdRef.current === jobId) {
      schedulePoll(context, jobId, nextUrl, 2000);
    }
  }
}

export function useJobPolling(context: PollContext) {
  return useCallback(
    (jobId: string, nextUrl: string) => {
      context.stopJobPolling();
      schedulePoll(context, jobId, nextUrl, 1500);
    },
    [context],
  );
}
