import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job, SessionSummary } from "../../../../shared/contracts";
import type { DownloadOptions } from "../../types/download";
import { workspaceRpc } from "../../services/orpcClient";

export function useWorkspaceQueue() {
  const queryClient = useQueryClient();
  const jobsQuery = useQuery(
    workspaceRpc.jobs.list.queryOptions({
      refetchInterval: 1_000,
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
  const pauseMutation = useMutation(workspaceRpc.jobs.pause.mutationOptions());
  const resumeMutation = useMutation(
    workspaceRpc.jobs.resume.mutationOptions(),
  );
  const cancelMutation = useMutation(
    workspaceRpc.jobs.cancel.mutationOptions(),
  );
  const retryMutation = useMutation(workspaceRpc.jobs.retry.mutationOptions());
  const removeMutation = useMutation(
    workspaceRpc.jobs.remove.mutationOptions(),
  );
  const reorderMutation = useMutation(
    workspaceRpc.jobs.reorder.mutationOptions(),
  );
  const schedulerQuery = useQuery(
    workspaceRpc.scheduler.get.queryOptions({ refetchInterval: 2_000 }),
  );
  const schedulerMutation = useMutation(
    workspaceRpc.scheduler.update.mutationOptions(),
  );
  async function refresh() {
    await queryClient.invalidateQueries();
  }
  async function control<T>(operation: Promise<T>): Promise<T> {
    const result = await operation;
    await refresh();
    return result;
  }

  return {
    cancel: (id: string) => control(cancelMutation.mutateAsync({ id })),
    enqueue: (
      items: readonly { url: string; downloadOptions: DownloadOptions }[],
    ) => control(enqueueMutation.mutateAsync({ items: [...items] })),
    isEnqueueing: enqueueMutation.isPending,
    jobs: jobsQuery.data?.items ?? ([] as Job[]),
    maxConcurrent: schedulerQuery.data?.maxConcurrent ?? 2,
    pause: (id: string) => control(pauseMutation.mutateAsync({ id })),
    remove: (id: string) => control(removeMutation.mutateAsync({ id })),
    reorder: (jobIds: string[]) =>
      control(reorderMutation.mutateAsync({ jobIds })),
    resume: (id: string) => control(resumeMutation.mutateAsync({ id })),
    retry: (id: string) => control(retryMutation.mutateAsync({ id })),
    setMaxConcurrent: (maxConcurrent: number) =>
      control(schedulerMutation.mutateAsync({ maxConcurrent })),
    sessions: sessionsQuery.data?.items ?? ([] as SessionSummary[]),
  };
}
