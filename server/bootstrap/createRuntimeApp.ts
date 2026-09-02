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
  createJob: (
    _url: string,
    _options: unknown,
    _sourcePreference?: "auto" | "http" | "torrent",
  ) => SessionJob;
  enqueueJob: (_job: SessionJob, _confirmOversize: boolean) => void;
  listOrderedJobs: () => readonly SessionJob[];
  pauseJob: (_id: string) => Promise<SessionJob>;
  resumeJob: (_id: string) => SessionJob;
  cancelJob: (_job: SessionJob) => SessionJob;
  retryJob: (_job: SessionJob) => SessionJob;
  removeJob: (_id: string) => Promise<void>;
  reorderJobs: (_ids: readonly string[]) => void;
  getSchedulerSettings: () => { activeCount: number; maxConcurrent: number };
  updateSchedulerSettings: (_value: number) => void;
  removeSession: (_id: string, _reason: string) => Promise<void>;
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
  const listJobs = () => deps.listOrderedJobs().map(deps.sanitizeJob);
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
        input.items.map(({ url, downloadOptions, sourcePreference }) => {
          const job = deps.createJob(url, downloadOptions, sourcePreference);
          deps.enqueueJob(job, input.confirmOversize);
          return deps.sanitizeJob(job);
        }),
      getSession: (id) => {
        const session = deps.sessions.get(id);
        return session ? summarizeSession(session) : undefined;
      },
      removeSession: (id) => deps.removeSession(id, "rpc"),
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
        return deps.sanitizeJob(deps.cancelJob(job));
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
        return deps.sanitizeJob(deps.retryJob(previous));
      },
      pauseJob: async (id) => deps.sanitizeJob(await deps.pauseJob(id)),
      resumeJob: (id) => deps.sanitizeJob(deps.resumeJob(id)),
      removeJob: deps.removeJob,
      reorderJobs: (ids) => {
        deps.reorderJobs(ids);
        return listJobs();
      },
      getSchedulerSettings: deps.getSchedulerSettings,
      updateSchedulerSettings: (maxConcurrent) => {
        deps.updateSchedulerSettings(maxConcurrent);
        return deps.getSchedulerSettings();
      },
    },
  });
}
