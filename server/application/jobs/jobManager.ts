import { rm } from "node:fs/promises";
import crypto from "node:crypto";
import {
  DEFAULT_DOWNLOAD_OPTIONS,
  DEFAULT_DOWNLOAD_SETTINGS,
  JOB_TTL_MS,
} from "../../config/runtimeConstants.js";
import type { SessionJob } from "../../domain/models.js";
import {
  normalizeDownloadOptions,
  normalizeDownloadSettings,
} from "../downloads/downloadOptions.js";
import { isTerminalJobStatus } from "../../infrastructure/runtime/runtimePrimitives.js";
import {
  detectSourceKind,
  type SourcePreference,
} from "../torrents/torrentSource.js";

type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;

class JobManager {
  constructor(
    private readonly jobStore: Map<string, SessionJob>,
    private readonly logEvent: LogEvent,
  ) {}

  createJob = (
    url: string,
    downloadOptions: unknown = DEFAULT_DOWNLOAD_OPTIONS,
    sourcePreference: SourcePreference = "auto",
  ): SessionJob => {
    const defaults = normalizeDownloadSettings(DEFAULT_DOWNLOAD_SETTINGS);
    const now = Date.now();
    const job: SessionJob = {
      id: crypto.randomUUID(),
      url,
      sourceKind: detectSourceKind(url, sourcePreference),
      sourcePreference,
      status: "queued",
      phase: "queued",
      downloadedBytes: 0,
      reportedSize: 0,
      percent: 0,
      extractedEntries: 0,
      totalEntries: 0,
      downloadSpeedBytesPerSec: 0,
      averageSpeedBytesPerSec: 0,
      etaSeconds: null,
      isStalled: false,
      stallDurationMs: 0,
      retryCount: 0,
      maxRetries: defaults.maxRetries,
      canResume: false,
      canPause: false,
      queuePosition: 0,
      pauseRequested: false,
      threadMode: defaults.threadMode,
      threadCount: defaults.threadCount,
      peerCount: 0,
      verifiedBytes: 0,
      uploadedBytes: 0,
      uploadSpeedBytesPerSec: 0,
      enableMultithread: defaults.enableMultithread,
      enableResume: defaults.enableResume,
      message: "Waiting to start",
      error: "",
      requiresConfirmation: false,
      sessionId: "",
      createdAt: now,
      updatedAt: now,
      transcodedEntries: 0,
      totalTranscodeEntries: 0,
      videoQuality: defaults.videoQuality,
      subscribers: new Set(),
      socketSubscribers: new Set(),
      workspaceDir: "",
      zipPath: "",
      extractDir: "",
      abortController: null,
      cleanupAt: 0,
      downloadOptions: normalizeDownloadOptions(downloadOptions),
    };
    this.jobStore.set(job.id, job);
    return job;
  };

  sanitizeJob = (job: SessionJob) => {
    return {
      id: job.id,
      url: job.url,
      sourceKind: job.sourceKind,
      sourcePreference: job.sourcePreference,
      status: job.status,
      phase: job.phase,
      downloadedBytes: job.downloadedBytes,
      reportedSize: job.reportedSize,
      percent: job.percent,
      extractedEntries: job.extractedEntries,
      totalEntries: job.totalEntries,
      downloadSpeedBytesPerSec: job.downloadSpeedBytesPerSec,
      averageSpeedBytesPerSec: job.averageSpeedBytesPerSec,
      etaSeconds: job.etaSeconds,
      isStalled: job.isStalled,
      stallDurationMs: job.stallDurationMs,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      canResume: job.canResume,
      canPause: job.canPause,
      queuePosition: job.queuePosition,
      threadMode: job.threadMode,
      threadCount: job.threadCount,
      peerCount: job.peerCount,
      verifiedBytes: job.verifiedBytes,
      uploadedBytes: job.uploadedBytes,
      uploadSpeedBytesPerSec: job.uploadSpeedBytesPerSec,
      enableMultithread: job.enableMultithread,
      enableResume: job.enableResume,
      message: job.message,
      error: job.error,
      requiresConfirmation: job.requiresConfirmation,
      sessionId: job.sessionId,
      transcodedEntries: job.transcodedEntries,
      totalTranscodeEntries: job.totalTranscodeEntries,
      videoQuality: job.videoQuality,
      downloadOptions: {
        ...job.downloadOptions,
        request: { ...job.downloadOptions.request, headers: {} },
      },
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  };

  closeJob = (job: SessionJob, status: SessionJob["status"]): void => {
    Object.assign(job, {
      status,
      updatedAt: Date.now(),
      cleanupAt: Date.now() + JOB_TTL_MS,
    });
  };

  emitJob = (
    job: SessionJob,
    patch: Partial<SessionJob> = {},
    event = "progress",
  ): void => {
    Object.assign(job, patch, { updatedAt: Date.now() });
    const sanitized = this.sanitizeJob(job);
    const socketPayload = JSON.stringify({ type: event, job: sanitized });
    for (const response of job.subscribers) {
      response.write(`event: ${event}\ndata: ${JSON.stringify(sanitized)}\n\n`);
      if (isTerminalJobStatus(job.status)) response.end();
    }
    for (const socket of job.socketSubscribers) {
      if (socket.readyState === 1) socket.send(socketPayload);
    }
    if (isTerminalJobStatus(job.status)) {
      job.subscribers.clear();
      job.socketSubscribers.clear();
    }
  };

  cleanupJob = async (jobId: string, reason = "cleanup"): Promise<void> => {
    const job = this.jobStore.get(jobId);
    if (!job) return;
    if (job.workspaceDir && !job.sessionId) {
      await rm(job.workspaceDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    for (const response of job.subscribers) response.end();
    for (const socket of job.socketSubscribers)
      socket.close(1000, "job-cleanup");
    this.jobStore.delete(jobId);
    this.logEvent("info", "job.removed", { jobId, reason });
  };
}

export function createJobManager(
  jobStore: Map<string, SessionJob>,
  logEvent: LogEvent,
) {
  return new JobManager(jobStore, logEvent);
}
