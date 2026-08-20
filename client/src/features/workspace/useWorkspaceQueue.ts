import { useMutation, useQuery } from "@tanstack/react-query";
import type { Job, SessionSummary } from "../../../../shared/contracts";
import { workspaceRpc } from "../../services/orpcClient";

export function useWorkspaceQueue() {
  const jobsQuery = useQuery(
    workspaceRpc.jobs.list.queryOptions({
      refetchInterval: 2_000,
      retry: false,
    }),
  );
  const sessionsQuery = useQuery(
    workspaceRpc.sessions.list.queryOptions({
      refetchInterval: 4_000,
      retry: false,
    }),
  );
  const enqueueMutation = useMutation(
    workspaceRpc.jobs.enqueue.mutationOptions(),
  );

  return {
    enqueue: (urls: readonly string[]) =>
      enqueueMutation.mutateAsync({ urls: [...urls] }),
    isEnqueueing: enqueueMutation.isPending,
    jobs: jobsQuery.data?.items ?? ([] as Job[]),
    sessions: sessionsQuery.data?.items ?? ([] as SessionSummary[]),
  };
}
