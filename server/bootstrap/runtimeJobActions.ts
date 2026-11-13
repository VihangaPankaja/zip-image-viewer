import type { Session, SessionJob, VideoTranscodeEntry } from "../domain/models.js";
import type { createJobManager } from "../application/jobs/jobManager.js";
import type { createSessionJobQueue } from "../application/jobs/sessionJobQueue.js";
import { createSessionManager } from "../application/sessions/sessionManager.js";
import { assertHttpWorkspace } from "../infrastructure/downloads/httpWorkspace.js";

export function createRuntimeJobActions(
  jobs: Map<string, SessionJob>,
  sessions: Map<string, Session>,
  transcodes: Map<string, VideoTranscodeEntry>,
  manager: ReturnType<typeof createJobManager>,
  queue: ReturnType<typeof createSessionJobQueue>,
  logEvent: Parameters<typeof createSessionManager>[2],
  cleanupVideoSession: (_session: Session) => Promise<void>,
) {
  const sessionManager = createSessionManager(sessions, transcodes, logEvent, cleanupVideoSession);
  const cancelSessionJob = (job: SessionJob) => {
    queue.cancelSessionJob(job.id);
    manager.closeJob(job, job.status);
    manager.emitJob(job, {}, job.status === "cancelled" ? "cancelled" : "progress");
    return job;
  };
  async function removeSession(id: string, reason: string) {
    const owningJob = [...jobs.values(), ...queue.getOrderedJobs()].find(
      (job) => job.sessionId === id,
    );
    if (owningJob && !["expired", "shutdown", "viewer"].includes(reason)) {
      await assertHttpWorkspace(owningJob);
      // Reject deletion while a worker is still using the files.
      queue.removeSessionJob(owningJob.id);
      await sessionManager.removeSession(id, reason);
      owningJob.sessionId = "";
      await manager.cleanupJob(owningJob.id, reason);
      return;
    }
    await sessionManager.removeSession(id, reason);
  }
  async function removeSessionJob(jobId: string) {
    const job = jobs.get(jobId);
    if (
      job &&
      (job.sourceKind === "torrent" || job.storageRoot) &&
      job.sessionId &&
      sessions.has(job.sessionId)
    ) {
      await removeSession(job.sessionId, "removed");
      return;
    }
    queue.removeSessionJob(jobId);
    if (job?.sourceKind === "torrent" || job?.storageRoot) job.sessionId = "";
    await manager.cleanupJob(jobId, "removed");
  }
  return {
    cancelSessionJob,
    retrySessionJob: (job: SessionJob) => retrySessionJob(job, manager, queue),
    removeSessionJob,
    removeSession,
    touchSession: sessionManager.touchSession,
  };
}

function retrySessionJob(
  previous: SessionJob,
  manager: ReturnType<typeof createJobManager>,
  queue: ReturnType<typeof createSessionJobQueue>,
): SessionJob {
  const retainedSource =
    previous.archive || previous.torrentArchivePath || previous.sourceKind === "http";
  if (previous.storageRoot && retainedSource) {
    manager.emitJob(previous, {
      status: "queued",
      phase: "queued",
      error: "",
      extraction: undefined,
      percent: null,
      message: "Waiting to retry",
    });
    queue.enqueueSessionJob(previous, !!previous.oversizeConfirmed);
    return previous;
  }
  const job = manager.createJob(previous.url, previous.downloadOptions, previous.sourcePreference);
  job.torrentFiles = previous.torrentFiles.map((file) => ({
    ...file,
    downloadedBytes: 0,
    complete: false,
  }));
  job.torrentMetadata = previous.torrentMetadata;
  queue.enqueueSessionJob(job, false);
  return job;
}
