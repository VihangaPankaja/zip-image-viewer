import type { Session, SessionJob } from "../domain/models.js";
import { ApplicationError } from "../domain/models.js";
import { isTerminalJobStatus } from "../infrastructure/runtime/runtimePrimitives.js";
import { createApp } from "./createApp.js";
import type { Job } from "../../shared/contracts.js";

type Dependencies = {
  metrics: { getSessionCount: () => number; getJobCount: () => number };
  distDir: string;
  jobs: Map<string, SessionJob>;
  sessions: Map<string, Session>;
  sanitizeJob: (_job: SessionJob) => Job;
  createJob: (_url: string, _options: unknown) => SessionJob;
  enqueueJob: (_job: SessionJob, _confirmOversize: boolean) => void;
  closeJob: (_job: SessionJob, _status: SessionJob["status"]) => void;
  emitJob: (
    _job: SessionJob,
    _patch: Partial<SessionJob>,
    _event?: string,
  ) => void;
};

function summarizeSession(session: Session) {
  return {
    id: session.id,
    firstFilePath: session.firstFilePath,
    fileCount: session.stats.fileCount,
    lastAccessedAt: session.lastAccessedAt,
  };
}

export function createRuntimeApp(deps: Dependencies) {
  const listJobs = () => Array.from(deps.jobs.values(), deps.sanitizeJob);
  const listSessions = () =>
    Array.from(deps.sessions.values(), summarizeSession);
  return createApp({
    ...deps.metrics,
    distDir: deps.distDir,
    listJobs,
    listSessions,
    rpc: {
      listJobs,
      listSessions,
      createJob: (input) => {
        const job = deps.createJob(
          input.url,
          input.downloadOptions ?? input.downloadSettings,
        );
        deps.enqueueJob(job, input.confirmOversize);
        return deps.sanitizeJob(job);
      },
      enqueueJobs: (input) =>
        input.urls.map((url) => {
          const job = deps.createJob(url, input.downloadOptions);
          deps.enqueueJob(job, input.confirmOversize);
          return deps.sanitizeJob(job);
        }),
      getSession: (id) => {
        const session = deps.sessions.get(id);
        return session ? summarizeSession(session) : undefined;
      },
      cancelJob: (id) => {
        const job = deps.jobs.get(id);
        if (!job)
          throw new ApplicationError("NOT_FOUND", "Job not found.", 404);
        if (isTerminalJobStatus(job.status)) {
          throw new ApplicationError(
            "CONFLICT",
            "Job is already complete.",
            409,
          );
        }
        job.abortController?.abort();
        deps.closeJob(job, "cancelled");
        deps.emitJob(
          job,
          { phase: "cancelled", message: "Cancelled" },
          "cancelled",
        );
        return deps.sanitizeJob(job);
      },
      retryJob: (id) => {
        const previous = deps.jobs.get(id);
        if (!previous)
          throw new ApplicationError("NOT_FOUND", "Job not found.", 404);
        if (previous.status !== "error" && previous.status !== "cancelled") {
          throw new ApplicationError(
            "CONFLICT",
            "Only failed or cancelled jobs can be retried.",
            409,
          );
        }
        const job = deps.createJob(previous.url, previous.downloadOptions);
        deps.enqueueJob(job, false);
        return deps.sanitizeJob(job);
      },
    },
  });
}
