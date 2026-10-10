import { path7za } from "7zip-bin";
import ffmpegPath from "ffmpeg-static";
import path from "node:path";
import { createStartupServer } from "./bootstrap/startupServer.js";
import { attachJobWebSocketServer } from "./realtime/jobSocketServer.js";
import {
  CLEANUP_INTERVAL_MS,
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
import { registerBaseRoutes } from "./bootstrap/registerRoutes.js";
import { registerSessionRoutes } from "./handlers/sessions.js";
import { getVideoQualities } from "./handlers/video/metadataRoutes.js";
import { registerVideoRoutes } from "./handlers/videoRoutes.js";
import { registerFileRoutes } from "./handlers/fileRoutes.js";
import { createSessionJobQueue } from "./application/jobs/sessionJobQueue.js";
import { createTorrentControls } from "./application/torrents/torrentControls.js";
import {
  createProcessSessionJob,
  restoreTorrentSession,
} from "./application/jobs/processSessionJob.js";
import { createJobManager } from "./application/jobs/jobManager.js";
import { createRetainedTorrentStore } from "./repositories/retainedTorrents.js";
import { restoreRetainedTorrents } from "./application/torrents/restoreRetainedTorrents.js";
import { createRuntimeJobActions } from "./bootstrap/runtimeJobActions.js";
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
import { readPreviewChunk } from "./infrastructure/media/imagePreviews.js";
import { createRuntimeMedia } from "./bootstrap/runtimeMedia.js";
import { listExtractedEntries } from "./infrastructure/archive/listExtractedEntries.js";
import {
  detectRuntimeArchiveEncryption,
  downloadRuntimeSource,
  extractRuntimeArchive,
} from "./runtimeAdapters.js";

const distDir = path.resolve(process.cwd(), "dist");
const retainedTorrents = createRetainedTorrentStore(
  path.resolve(process.cwd(), "sessions"),
);
const container = createServerContainer();
const { server, setApp } = createStartupServer(() => retainedTorrents.close());
const {
  videoRuntime,
  enforceMediaBudget,
  pinMediaRequest,
  ensureThumbnail,
  ensureImagePreview,
} = createRuntimeMedia(ffmpegPath, sessionStore, videoTranscodeStore, logEvent);
const {
  ensureVideoTranscodeEntry,
  ensureVideoStoryboard,
  cleanupVideoSession,
  getSessionQualityOutputPath,
  prepareVideoRemux,
  getVideoMetadata,
  getVideoTranscodeKey,
  startPrioritySegmentWindow,
  startRenditionTranscode,
} = videoRuntime;

const jobManager = createJobManager(jobStore, logEvent, retainedTorrents);
const { createJob, sanitizeJob, closeJob, emitJob, cleanupJob } = jobManager;
const { torrentAdapter, ...torrentControls } = createTorrentControls(
  jobStore,
  emitJob,
);
const processorDependencies = {
  sessionStore,
  emitJob,
  closeJob,
  download: downloadRuntimeSource,
  detectEncryption: (archivePath: string) =>
    detectRuntimeArchiveEncryption(path7za, archivePath),
  extractWith7zip: (archivePath: string, extractDir: string) =>
    extractRuntimeArchive(path7za, archivePath, extractDir),
  listExtractedEntries,
  logEvent,
  torrentAdapter,
};
const processSessionJob = createProcessSessionJob(processorDependencies);

server.listen(PORT, "0.0.0.0");

await restoreRetainedTorrents(
  retainedTorrents,
  jobStore,
  torrentAdapter,
  (job) => restoreTorrentSession(job, processorDependencies),
);

const sessionJobQueue = createSessionJobQueue({
  initialJobs: [...jobStore.values()],
  pendingSessionJobs,
  getActiveSessionJobCount,
  incrementActiveSessionJobCount,
  decrementActiveSessionJobCount,
  maxActiveSessionJobs: 2,
  processSessionJob,
  emitJob,
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

const {
  cancelSessionJob,
  retrySessionJob,
  removeSessionJob,
  removeSession,
  touchSession,
} = createRuntimeJobActions(
  jobStore,
  sessionStore,
  videoTranscodeStore,
  jobManager,
  sessionJobQueue,
  logEvent,
  cleanupVideoSession,
);

const app = createRuntimeApp({
  videoQualities: (input) =>
    getVideoQualities(input, {
      touchSession,
      sanitizeEntryPath: container.runtime.sanitizeEntryPath,
      VIDEO_EXTENSIONS,
      getVideoMetadata,
      buildVideoQualityOptions: videoRuntime.buildVideoQualityOptions,
    }),
  metrics: container.metrics,
  distDir,
  jobs: jobStore,
  sessions: sessionStore,
  sanitizeJob,
  createJob,
  enqueueJob: enqueueSessionJob,
  confirmJob: sessionJobQueue.confirmSessionJob,
  selectTorrentFiles: sessionJobQueue.selectTorrentFiles,
  ...torrentControls,
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

app.use("/api/sessions/:id", pinMediaRequest);

app.use((req, res, next) => {
  const isTrackedRequest =
    req.path === "/health" || req.path.startsWith("/api");
  if (!isTrackedRequest) {
    next();
    return;
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
registerRuntimeLifecycle({
  sessions: sessionStore,
  jobs: jobStore,
  getServer: () => server,
  stopWorkers: sessionJobQueue.stopSessionJobs,
  removeSession,
  cleanupJob,
  logEvent,
  shutdownServices: [
    () => {
      dashboard?.close();
      return Promise.resolve();
    },
    () => torrentAdapter.close(),
    () => {
      retainedTorrents.close();
      return Promise.resolve();
    },
  ],
});

registerBaseRoutes(app, {
  removeJob: removeSessionJob,
  getSessionCount: container.metrics.getSessionCount,
  getJobCount: container.metrics.getJobCount,
  getJob: (jobId) => jobStore.get(jobId),
  sanitizeJob,
  confirmSessionJob: sessionJobQueue.confirmSessionJob,
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
  prepareVideoRemux,
  parseRangeHeader: container.runtime.parseRangeHeader,
  VIDEO_EXTENSIONS,
  getVideoMetadata,
  buildVideoQualityOptions: videoRuntime.buildVideoQualityOptions,
  parseSeekSeconds,
  ensureVideoTranscodeEntry,
  getRenditionState: videoRuntime.getRenditionState,
  startRenditionTranscode,
  startPrioritySegmentWindow,
  refreshRenditionAvailability: videoRuntime.refreshRenditionAvailability,
  DEFAULT_VIDEO_SEGMENT_SECONDS: 4,
  runCommand: videoRuntime.runCommand,
  ensureVideoStoryboard,
  runVideoTask: videoRuntime.runVideoTask,
  trackVideoTask: videoRuntime.trackVideoTask,
  getVideoTranscodeKey,
  videoTranscodeStore,
  waitForFile: videoRuntime.waitForFile,
  getVideoDimensions: videoRuntime.getVideoDimensions,
  logEvent: container.runtime.logEvent,
  enforceDerivedMediaBudget: enforceMediaBudget,
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

setApp(app);
attachJobWebSocketServer(server, { jobStore, sanitizeJob });

dashboard?.start();

logEvent("info", "server.started", {
  url: `http://0.0.0.0:${PORT}`,
  sessionTtlMs: SESSION_TTL_MS,
  cleanupIntervalMs: CLEANUP_INTERVAL_MS,
});
