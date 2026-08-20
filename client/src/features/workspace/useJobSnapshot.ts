import { useCallback, type Dispatch, type SetStateAction } from "react";
import { getJobSnapshotAction } from "./jobLifecycle";
import type {
  JobPayload,
  OversizePrompt,
  SessionPayload,
} from "./sessionSchemas";
import type { JobTransport } from "./useJobTransport";

type SnapshotContext = Pick<
  JobTransport,
  "closeJobEvents" | "latestJobIdRef" | "stopJobPolling"
> & {
  hydrateSession: (
    sessionId: string,
    nextUrl: string,
  ) => Promise<SessionPayload | null>;
  setActiveJob: Dispatch<SetStateAction<JobPayload | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setOversizePrompt: Dispatch<SetStateAction<OversizePrompt | null>>;
};

function finishJob(context: SnapshotContext, clearPrompt: boolean) {
  context.closeJobEvents();
  context.stopJobPolling();
  context.latestJobIdRef.current = "";
  context.setActiveJob(null);
  context.setIsLoading(false);
  if (clearPrompt) context.setOversizePrompt(null);
}

async function applyJobSnapshot(
  context: SnapshotContext,
  payload: JobPayload,
  nextUrl: string,
) {
  context.latestJobIdRef.current = payload.id ?? "";
  context.setActiveJob(payload);
  if (payload.sessionId)
    await context.hydrateSession(payload.sessionId, nextUrl);

  const action = getJobSnapshotAction(payload);
  if (action.kind === "progress") return;
  if (action.kind === "awaiting_confirmation") {
    context.setOversizePrompt(action.prompt);
    context.setIsLoading(false);
    return;
  }
  if (action.kind === "error") {
    finishJob(context, false);
    context.setError(action.message);
    return;
  }
  finishJob(context, action.kind === "ready");
}

export function useJobSnapshot(context: SnapshotContext) {
  return useCallback(
    (payload: JobPayload, nextUrl: string) =>
      applyJobSnapshot(context, payload, nextUrl),
    [context],
  );
}
