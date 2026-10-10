import type {
  Session,
  SessionJob,
  VideoTranscodeEntry,
} from "../domain/models.js";
import type { createJobManager } from "../application/jobs/jobManager.js";
import type { createSessionJobQueue } from "../application/jobs/sessionJobQueue.js";
import { createSessionManager } from "../application/sessions/sessionManager.js";

export function createRuntimeJobActions(
  jobs: Map<string, SessionJob>,
  sessions: Map<string, Session>,
  transcodes: Map<string, VideoTranscodeEntry>,
  manager: ReturnType<typeof createJobManager>,
  queue: ReturnType<typeof createSessionJobQueue>,
  logEvent: Parameters<typeof createSessionManager>[2],
  cleanupVideoSession: (_session: Session) => Promise<void>,
) {
  const sessionManager = createSessionManager(
    sessions,
    transcodes,
    logEvent,
    cleanupVideoSession,
  );
  const cancelSessionJob = (job: SessionJob) => {
    queue.cancelSessionJob(job.id);
    manager.closeJob(job, "cancelled");
    manager.emitJob(
      job,
      { phase: "cancelled", message: "Cancelled" },
      "cancelled",
    );
    return job;
  };
  const retrySessionJob = (previous: SessionJob) => {
    const job = manager.createJob(
      previous.url,
      previous.downloadOptions,
      previous.sourcePreference,
    );
    job.torrentFiles = previous.torrentFiles.map((file) => ({
      ...file,
      downloadedBytes: 0,
      complete: false,
    }));
    job.torrentMetadata = previous.torrentMetadata;
    queue.enqueueSessionJob(job, false);
    return job;
  };
  async function removeSession(id: string, reason: string) {
    const retainedJob = [...jobs.values()].find(
      (job) => job.sourceKind === "torrent" && job.sessionId === id,
    );
    if (retainedJob && !["expired", "shutdown", "viewer"].includes(reason)) {
      // Reject deletion while a worker is still using the files.
      queue.removeSessionJob(retainedJob.id);
      await sessionManager.removeSession(id, reason);
      retainedJob.sessionId = "";
      await manager.cleanupJob(retainedJob.id, reason);
      return;
    }
    await sessionManager.removeSession(id, reason);
  }
  async function removeSessionJob(jobId: string) {
    const job = jobs.get(jobId);
    if (
      job?.sourceKind === "torrent" &&
      job.sessionId &&
      sessions.has(job.sessionId)
    ) {
      await removeSession(job.sessionId, "removed");
      return;
    }
    queue.removeSessionJob(jobId);
    if (job?.sourceKind === "torrent") job.sessionId = "";
    await manager.cleanupJob(jobId, "removed");
  }
  return {
    cancelSessionJob,
    retrySessionJob,
    removeSessionJob,
    removeSession,
    touchSession: sessionManager.touchSession,
  };
}
