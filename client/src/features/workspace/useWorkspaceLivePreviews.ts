import { useQueries } from "@tanstack/react-query";
import {
  torrentVideoInfoSchema,
  type Job,
  type SessionSummary,
} from "../../../../shared/contracts";
import { livePreviewFiles, type LivePreview } from "./workspaceRail";

export function useWorkspaceLivePreviews(
  jobs: readonly Job[],
  sessions: readonly SessionSummary[],
): LivePreview[] {
  const ready = sessions.filter(({ fileCount }) => fileCount > 0);
  const readySessions = new Set(ready.map(({ id }) => id));
  const readyJobs = new Set(ready.map(({ jobId }) => jobId));
  const candidates = jobs.filter(
    (job) =>
      !readyJobs.has(job.id) &&
      !readySessions.has(job.sessionId) &&
      livePreviewFiles(job).length > 0,
  );
  const results = useQueries({
    queries: candidates.map((job) => ({
      queryKey: ["workspace-live-preview", job.id, livePreviewFiles(job).map(({ id }) => id)],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        for (const file of livePreviewFiles(job)) {
          try {
            const query = new URLSearchParams({ fileId: file.id });
            const response = await fetch(`/api/session-jobs/${job.id}/video/info?${query}`, {
              signal,
            });
            if (!response.ok) continue;
            const info = torrentVideoInfoSchema.safeParse(await response.json());
            if (info.success && info.data.state === "ready")
              return { jobId: job.id, fileId: file.id };
          } catch (error) {
            if (signal.aborted) throw error;
          }
        }
        return null;
      },
      refetchInterval: 10_000,
      gcTime: 0,
      retry: false,
    })),
  });
  return results.flatMap((result) => (result.data && !result.isError ? [result.data] : []));
}
