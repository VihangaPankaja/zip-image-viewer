import { implement, ORPCError } from "@orpc/server";
import {
  serverContract,
  type CreateSessionInput,
  type EnqueueSessionsInput,
  type Job,
  type SchedulerSettings,
  type TorrentLimits,
  type TorrentPriority,
  type SessionSummary,
  type VideoQualities,
  type VideoQualitiesInput,
} from "../../shared/contracts.js";

import { ApplicationError } from "../domain/models.js";

export type ServerRpcDependencies = {
  videoQualities: (_input: VideoQualitiesInput) => Promise<VideoQualities>;
  listJobs: () => readonly Job[];
  listSessions: () => readonly SessionSummary[];
  createJob: (_input: CreateSessionInput) => Job | Promise<Job>;
  enqueueJobs: (_input: EnqueueSessionsInput) => Job[] | Promise<Job[]>;
  getSession: (_id: string) => SessionSummary | undefined;
  cancelJob: (_id: string) => Job | Promise<Job>;
  confirmJob: (_id: string) => Job | Promise<Job>;
  selectFiles: (_id: string, _fileIds: string[]) => Job | Promise<Job>;
  setFilePriority: (
    _id: string,
    _fileId: string,
    _priority: TorrentPriority,
  ) => Job | Promise<Job>;
  retryJob: (_id: string) => Job | Promise<Job>;
  pauseJob: (_id: string) => Job | Promise<Job>;
  resumeJob: (_id: string) => Job | Promise<Job>;
  removeJob: (_id: string) => void | Promise<void>;
  reorderJobs: (_jobIds: readonly string[]) => Job[] | Promise<Job[]>;
  getSchedulerSettings: () => SchedulerSettings;
  updateSchedulerSettings: (_maxConcurrent: number) => SchedulerSettings;
  getTorrentLimits: () => TorrentLimits;
  updateTorrentLimits: (_limits: TorrentLimits) => TorrentLimits;
  removeSession: (_id: string) => void | Promise<void>;
};

async function videoQualities(
  deps: ServerRpcDependencies,
  input: VideoQualitiesInput,
) {
  try {
    return await deps.videoQualities(input);
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw new ORPCError(error.code, {
        status: error.status,
        message: error.message,
      });
    }
    throw error;
  }
}
export function createServerRpcRouter(deps: ServerRpcDependencies) {
  const contract = implement(serverContract);
  return contract.router({
    video: {
      qualities: contract.video.qualities.handler(({ input }) =>
        videoQualities(deps, input),
      ),
    },
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
      remove: contract.sessions.remove.handler(({ input }) =>
        deps.removeSession(input.id),
      ),
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
      confirm: contract.jobs.confirm.handler(({ input }) =>
        deps.confirmJob(input.id),
      ),
      selectFiles: contract.jobs.selectFiles.handler(({ input }) =>
        deps.selectFiles(input.id, input.fileIds),
      ),
      setFilePriority: contract.jobs.setFilePriority.handler(({ input }) =>
        deps.setFilePriority(input.id, input.fileId, input.priority),
      ),
      retry: contract.jobs.retry.handler(({ input }) =>
        deps.retryJob(input.id),
      ),
      pause: contract.jobs.pause.handler(({ input }) =>
        deps.pauseJob(input.id),
      ),
      resume: contract.jobs.resume.handler(({ input }) =>
        deps.resumeJob(input.id),
      ),
      remove: contract.jobs.remove.handler(({ input }) =>
        deps.removeJob(input.id),
      ),
      reorder: contract.jobs.reorder.handler(({ input }) =>
        deps.reorderJobs(input.jobIds),
      ),
    },
    scheduler: {
      get: contract.scheduler.get.handler(() => deps.getSchedulerSettings()),
      update: contract.scheduler.update.handler(({ input }) =>
        deps.updateSchedulerSettings(input.maxConcurrent),
      ),
    },
    torrentLimits: {
      get: contract.torrentLimits.get.handler(() => deps.getTorrentLimits()),
      update: contract.torrentLimits.update.handler(({ input }) =>
        deps.updateTorrentLimits(input),
      ),
    },
  });
}
