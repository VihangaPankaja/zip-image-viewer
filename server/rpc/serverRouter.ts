import { implement } from "@orpc/server";
import {
  serverContract,
  type CreateSessionInput,
  type EnqueueSessionsInput,
  type Job,
  type SessionSummary,
} from "../../shared/contracts.js";

export type ServerRpcDependencies = {
  listJobs: () => readonly Job[];
  listSessions: () => readonly SessionSummary[];
  createJob: (_input: CreateSessionInput) => Job | Promise<Job>;
  enqueueJobs: (_input: EnqueueSessionsInput) => Job[] | Promise<Job[]>;
  getSession: (_id: string) => SessionSummary | undefined;
  cancelJob: (_id: string) => Job | Promise<Job>;
  retryJob: (_id: string) => Job | Promise<Job>;
};

export function createServerRpcRouter(deps: ServerRpcDependencies) {
  const contract = implement(serverContract);
  return contract.router({
    sessions: {
      create: contract.sessions.create.handler(({ input }) =>
        deps.createJob(input),
      ),
      get: contract.sessions.get.handler(({ input }) => {
        const session = deps.getSession(input.id);
        if (!session) throw new Error("Session not found.");
        return session;
      }),
      list: contract.sessions.list.handler(() => ({
        items: [...deps.listSessions()],
      })),
    },
    jobs: {
      list: contract.jobs.list.handler(() => ({
        items: [...deps.listJobs()],
      })),
      enqueue: contract.jobs.enqueue.handler(async ({ input }) => ({
        items: await deps.enqueueJobs(input),
      })),
      cancel: contract.jobs.cancel.handler(({ input }) =>
        deps.cancelJob(input.id),
      ),
      retry: contract.jobs.retry.handler(({ input }) =>
        deps.retryJob(input.id),
      ),
    },
  });
}
