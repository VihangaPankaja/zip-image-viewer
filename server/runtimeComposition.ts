import { createRequire } from "node:module";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { attachJobWebSocketServer } from "./realtime/jobSocketServer.js";
import { downloadWithSegmentedManager } from "./services/segmentedDownloader.js";
import {
  CLEANUP_INTERVAL_MS,
  CONFIRM_SIZE_BYTES,
  PORT,
  SESSION_TTL_MS,
} from "./config/runtimeConstants.js";
import {
  decrementActiveSessionJobCount,
  getActiveSessionJobCount,
  incrementActiveSessionJobCount,
  jobStore,
  pendingSessionJobs,
  sessionStore,
  videoTranscodeStore,
} from "./repositories/memoryStores.js";
import { createServerContainer } from "./bootstrap/container.js";
import { createRuntimeApp } from "./bootstrap/createRuntimeApp.js";
import { registerRuntimeLifecycle } from "./bootstrap/runtimeLifecycle.js";
import type { Session, SessionJob } from "./domain/models.js";
import { registerBaseRoutes } from "./bootstrap/registerRoutes.js";
import { registerSessionRoutes } from "./handlers/sessions.js";
import { registerVideoRoutes } from "./handlers/videoRoutes.js";
import { registerFileRoutes } from "./handlers/fileRoutes.js";
import { createSessionJobQueue } from "./application/jobs/sessionJobQueue.js";
import { createWebTorrentAdapter } from "./application/torrents/torrentDownloader.js";
import { createProcessSessionJob } from "./application/jobs/processSessionJob.js";
import { createJobManager } from "./application/jobs/jobManager.js";
import { createSessionManager } from "./application/sessions/sessionManager.js";
import type { DownloadSettings } from "./application/downloads/downloadOptions.js";
import {
  getLogEntries,
  isTerminalJobStatus,
  logEvent,
  setPlainLoggingEnabled,
  subscribeLogEvents,
} from "./infrastructure/runtime/runtimePrimitives.js";
import {
  createTerminalDashboard,
  shouldUseTerminalDashboard,
} from "./tui/dashboard.js";
import {
  VIDEO_EXTENSIONS,
  classifyMimeType,
  parseSeekSeconds,
  shouldPreserveOriginalPreview,
} from "./infrastructure/runtime/mediaClassification.js";
import type { RemoteMetadata } from "./infrastructure/downloads/remoteMetadata.js";
import {
  ensureImagePreview as generateImagePreview,
  ensureThumbnail as generateThumbnail,
  readPreviewChunk,
} from "./infrastructure/media/imagePreviews.js";
import {
  detectArchiveEncryption as inspectArchiveEncryption,
  extractWith7zip as extractArchiveWith7zip,
} from "./infrastructure/process/commandRunner.js";
import { createVideoRuntime } from "./infrastructure/media/videoRuntime.js";
import { listExtractedEntries } from "./infrastructure/archive/listExtractedEntries.js";

const require = createRequire(import.meta.url);
const sevenZipModule: unknown = require("7zip-bin");
const path7za =
  typeof sevenZipModule === "object" &&
  sevenZipModule !== null &&
  "path7za" in sevenZipModule &&
  typeof sevenZipModule.path7za === "string"
    ? sevenZipModule.path7za
    : "";
const ffmpegModule: unknown = require("ffmpeg-static");
const ffmpegPath = typeof ffmpegModule === "string" ? ffmpegModule : null;

const distDir = path.resolve(process.cwd(), "dist");
const container = createServerContainer();
let server: Server | undefined;
const DEFAULT_VIDEO_SEGMENT_SECONDS = 4;
const MAX_ACTIVE_SESSION_JOBS = 2;

type DownloadState = {
  downloadedBytes: number;
  reportedSize: number;
  statusText: string;
};

const videoRuntime = createVideoRuntime({
  ffmpegPath,
  transcodes: videoTranscodeStore,
  logEvent,
});
const {
  buildVideoQualityOptions,
  ensureVideoTranscodeEntry,
  getRenditionState,
  getSessionQualityOutputPath,
  getVideoDimensions,
  getVideoMetadata,
  getVideoTranscodeKey,
  refreshRenditionAvailability,
  runCommand,
  startPrioritySegmentWindow,
  startRenditionTranscode,
  waitForFile,
} = videoRuntime;

const { createJob, sanitizeJob, closeJob, emitJob, cleanupJob } =
  createJobManager(jobStore, logEvent);
const torrentAdapter = createWebTorrentAdapter();
const processSessionJob = createProcessSessionJob({
  sessionStore,
  emitJob,
  closeJob,
  download: downloadWithAria2,
  detectEncryption: detectArchiveEncryption,
  extractWith7zip,
  listExtractedEntries,
  logEvent,
  torrentAdapter,
});

const sessionJobQueue = createSessionJobQueue({
  pendingSessionJobs,
  getActiveSessionJobCount,
  incrementActiveSessionJobCount,
  decrementActiveSessionJobCount,
  maxActiveSessionJobs: MAX_ACTIVE_SESSION_JOBS,
  processSessionJob,
  pauseJob: (job) => {
    job.pauseRequested = true;
    job.abortController?.abort();
    emitJob(
      job,
      {
        status: "paused",
        phase: "paused",
        canPause: false,
        message: "Pausing download...",
      },
      "paused",
    );
    return Promise.resolve();
  },
  logEvent,
});
const { enqueueSessionJob } = sessionJobQueue;

function cancelSessionJob(job: SessionJob) {
  sessionJobQueue.cancelSessionJob(job.id);
  closeJob(job, "cancelled");
  emitJob(job, { phase: "cancelled", message: "Cancelled" }, "cancelled");
  return job;
}

function retrySessionJob(previous: SessionJob) {
  const job = createJob(
    previous.url,
    previous.downloadOptions,
    previous.sourcePreference,
  );
  enqueueSessionJob(job, false);
  return job;
}

async function removeSessionJob(jobId: string): Promise<void> {
  sessionJobQueue.removeSessionJob(jobId);
  await cleanupJob(jobId, "removed");
}

const app = createRuntimeApp({
  metrics: container.metrics,
  distDir,
  jobs: jobStore,
  sessions: sessionStore,
  sanitizeJob,
  createJob,
  enqueueJob: enqueueSessionJob,
  listOrderedJobs: sessionJobQueue.getOrderedJobs,
  pauseJob: sessionJobQueue.pauseSessionJob,
  resumeJob: sessionJobQueue.resumeSessionJob,
  cancelJob: cancelSessionJob,
  retryJob: retrySessionJob,
  removeJob: removeSessionJob,
  reorderJobs: sessionJobQueue.reorderSessionJobs,
  getSchedulerSettings: sessionJobQueue.getSchedulerState,
  updateSchedulerSettings: sessionJobQueue.setMaxActiveSessionJobs,
  removeSession: async (id, reason) => removeSession(id, reason),
});

app.use((req, res, next) => {
  const isTrackedRequest =
    req.path === "/health" || req.path.startsWith("/api");
  if (!isTrackedRequest) {
    return next();
  }

  const startedAt = Date.now();
  logEvent("info", "request.start", {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });

  res.on("finish", () => {
    logEvent("info", "request.finish", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

const { removeSession, touchSession } = createSessionManager(
  sessionStore,
  videoTranscodeStore,
  logEvent,
);
const dashboard = shouldUseTerminalDashboard({
  inputTTY: process.stdin.isTTY,
  outputTTY: process.stdout.isTTY,
  nodeEnv: process.env.NODE_ENV,
  lifecycleEvent: process.env.npm_lifecycle_event,
})
  ? createTerminalDashboard({
      input: process.stdin,
      output: process.stdout,
      getJobs: sessionJobQueue.getOrderedJobs,
      getSessions: () => [...sessionStore.values()],
      getSchedulerState: sessionJobQueue.getSchedulerState,
      getLogs: getLogEntries,
      subscribeLogs: subscribeLogEvents,
      setPlainLogging: setPlainLoggingEnabled,
      actions: {
        pause: sessionJobQueue.pauseSessionJob,
        resume: sessionJobQueue.resumeSessionJob,
        cancel: (id) => {
          const job = jobStore.get(id);
          if (!job || isTerminalJobStatus(job.status))
            throw new Error("Job cannot be cancelled.");
          cancelSessionJob(job);
        },
        retry: (id) => {
          const job = jobStore.get(id);
          if (!job || (job.status !== "error" && job.status !== "cancelled"))
            throw new Error("Only failed or cancelled jobs can be retried.");
          retrySessionJob(job);
        },
        removeJob: removeSessionJob,
        removeSession: (id) => removeSession(id, "tui"),
        reorder: sessionJobQueue.reorderSessionJobs,
        setMaxConcurrent: sessionJobQueue.setMaxActiveSessionJobs,
      },
      interrupt: () => process.kill(process.pid, "SIGINT"),
    })
  : undefined;
async function ensureThumbnail(
  session: Session,
  normalizedPath: string,
  targetPath: string,
  size: unknown,
): Promise<string> {
  return generateThumbnail(session, normalizedPath, targetPath, size, logEvent);
}

async function ensureImagePreview(
  session: Session,
  normalizedPath: string,
  targetPath: string,
  profileName: string,
): Promise<string> {
  return generateImagePreview(
    session,
    normalizedPath,
    targetPath,
    profileName,
    logEvent,
  );
}

async function extractWith7zip(
  archivePath: string,
  extractDir: string,
): Promise<void> {
  await extractArchiveWith7zip(path7za, archivePath, extractDir);
}

async function detectArchiveEncryption(archivePath: string): Promise<boolean> {
  return inspectArchiveEncryption(path7za, archivePath);
}

async function downloadWithAria2({
  url,
  targetPath,
  signal,
  settings,
  state,
  metadata,
  confirmOversize,
}: {
  url: string;
  targetPath: string;
  signal: AbortSignal;
  settings: DownloadSettings;
  state: DownloadState;
  metadata: RemoteMetadata;
  confirmOversize: boolean;
}): Promise<void> {
  await downloadWithSegmentedManager({
    url,
    targetPath,
    signal,
    settings,
    state,
    metadata,
  });

  if (!confirmOversize && state.downloadedBytes > CONFIRM_SIZE_BYTES) {
    throw Object.assign(new Error("Archive exceeds 1 GB."), {
      code: "OVERSIZE_CONFIRM",
    });
  }
}

registerRuntimeLifecycle({
  sessions: sessionStore,
  jobs: jobStore,
  getServer: () => server,
  removeSession,
  cleanupJob,
  logEvent,
  shutdownServices: [
    () => {
      dashboard?.close();
      return Promise.resolve();
    },
    () => torrentAdapter.close(),
  ],
});

registerBaseRoutes(app, {
  getSessionCount: container.metrics.getSessionCount,
  getJobCount: container.metrics.getJobCount,
  getJob: (jobId) => jobStore.get(jobId),
  sanitizeJob,
  enqueueSessionJob,
  parseRangeHeader: container.runtime.parseRangeHeader,
  emitJob,
  closeJob,
  cleanupJob,
});

registerSessionRoutes(app, {
  createJob,
  emitJob,
  enqueueSessionJob,
  sanitizeJob,
  touchSession,
  logEvent: container.runtime.logEvent,
  sessionStore,
  removeSession,
});

registerVideoRoutes(app, {
  touchSession,
  ffmpegPath,
  sanitizeEntryPath: container.runtime.sanitizeEntryPath,
  getSessionQualityOutputPath,
  parseRangeHeader: container.runtime.parseRangeHeader,
  VIDEO_EXTENSIONS,
  getVideoMetadata,
  buildVideoQualityOptions,
  parseSeekSeconds,
  ensureVideoTranscodeEntry,
  getRenditionState,
  startRenditionTranscode,
  startPrioritySegmentWindow,
  refreshRenditionAvailability,
  DEFAULT_VIDEO_SEGMENT_SECONDS,
  runCommand,
  getVideoTranscodeKey,
  videoTranscodeStore,
  waitForFile,
  getVideoDimensions,
  logEvent: container.runtime.logEvent,
});

registerFileRoutes(app, {
  touchSession,
  logEvent: container.runtime.logEvent,
  sanitizeEntryPath: container.runtime.sanitizeEntryPath,
  formatBytes: container.runtime.formatBytes,
  readPreviewChunk,
  classifyMimeType,
  ensureThumbnail,
  shouldPreserveOriginalPreview,
  ensureImagePreview,
  parseRangeHeader: container.runtime.parseRangeHeader,
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

server = createServer(app);
attachJobWebSocketServer(server, { jobStore, sanitizeJob });

dashboard?.start();

server.listen(PORT, "0.0.0.0", () => {
  logEvent("info", "server.started", {
    url: `http://0.0.0.0:${PORT}`,
    sessionTtlMs: SESSION_TTL_MS,
    cleanupIntervalMs: CLEANUP_INTERVAL_MS,
  });
});
