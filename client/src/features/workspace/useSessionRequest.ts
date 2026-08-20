import {
  useCallback,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  jobPayloadSchema,
  type JobPayload,
  type OversizePrompt,
} from "./sessionSchemas";
import type { JobTransport } from "./useJobTransport";

type SessionRequestContext = Pick<
  JobTransport,
  "closeJobEvents" | "latestJobIdRef" | "stopJobPolling"
> & {
  attachJobEvents: (jobId: string, nextUrl: string) => void;
  downloadOptions: unknown;
  downloadSettings: unknown;
  setActiveJob: Dispatch<SetStateAction<JobPayload | null>>;
  setError: Dispatch<SetStateAction<string>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setOversizePrompt: Dispatch<SetStateAction<OversizePrompt | null>>;
  setSlideshowOpen: Dispatch<SetStateAction<boolean>>;
};

async function loadSessionRequest(
  context: SessionRequestContext,
  url: string,
  confirmOversize: boolean,
) {
  context.setIsLoading(true);
  context.setError("");
  context.setOversizePrompt(null);
  context.setSlideshowOpen(false);
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        confirmOversize,
        downloadOptions: context.downloadOptions,
        downloadSettings: context.downloadSettings,
      }),
    });
    const parsed = jobPayloadSchema.safeParse(await response.json());
    const payload = parsed.success ? parsed.data : null;
    if (!response.ok || !payload) {
      throw new Error(payload?.error || "Could not open file URL.");
    }
    context.latestJobIdRef.current = payload.id ?? "";
    context.setActiveJob(payload);
    context.attachJobEvents(payload.id ?? "", url);
  } catch (error) {
    context.setError(
      error instanceof Error ? error.message : "Could not open file URL.",
    );
    context.latestJobIdRef.current = "";
    context.setActiveJob(null);
    context.stopJobPolling();
    context.closeJobEvents();
  }
}

async function submitSession(
  event: FormEvent,
  zipUrl: string,
  setError: Dispatch<SetStateAction<string>>,
  loadSession: (url: string, confirmOversize?: boolean) => Promise<void>,
) {
  event.preventDefault();
  const url = zipUrl.trim();
  if (!url) {
    setError("Paste a public ZIP URL to start browsing.");
    return;
  }
  await loadSession(url, false);
}

export function useSessionRequest(
  context: SessionRequestContext,
  zipUrl: string,
) {
  const loadSession = useCallback(
    (url: string, confirmOversize = false) =>
      loadSessionRequest(context, url, confirmOversize),
    [context],
  );
  const handleSubmit = useCallback(
    (event: FormEvent) =>
      submitSession(event, zipUrl, context.setError, loadSession),
    [context.setError, loadSession, zipUrl],
  );
  return { handleSubmit, loadSession };
}
