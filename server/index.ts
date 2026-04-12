// @ts-nocheck
import express from "express";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createServer } from "node:http";
import os from "node:os";
import crypto from "node:crypto";
import mime from "mime-types";
import sharp from "sharp";
import unzipper from "unzipper";
import { fileTypeFromFile } from "file-type";
import { attachJobWebSocketServer } from "./realtime/jobSocketServer.js";
import { downloadWithSegmentedManager } from "./services/segmentedDownloader.js";
import { createDownloadProgressMonitor } from "./services/jobProgressMonitor.js";

const require = createRequire(import.meta.url);
const { path7za } = require("7zip-bin");
const ffmpegPath = require("ffmpeg-static");

const distDir = path.resolve(process.cwd(), "dist");
const app = express();
const sessionStore = new Map();
const jobStore = new Map();
let server;
let isShuttingDown = false;

const PORT = Number(process.env.PORT || 8080);
const SESSION_TTL_MS = 30 * 60 * 1000;
const JOB_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const CONFIRM_SIZE_BYTES = 1024 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
const PROGRESS_EMIT_INTERVAL_MS = 1000;
const MAX_THUMBNAIL_SIZE = 320;
const DEFAULT_DOWNLOAD_SETTINGS = {
  threadMode: "auto",
  threadCount: 3,
  enableMultithread: true,
  enableResume: true,
  maxRetries: 3,
};
const DEFAULT_DOWNLOAD_OPTIONS = {
  transport: {
    mode: "auto",
    threads: 3,
    multithread: true,
    resume: true,
  },
  retry: {
    maxRetries: 3,
    timeoutMs: 30000,
  },
  media: {
    videoQuality: "720p",
  },
  extraction: {
    enabled: true,
  },
  request: {
    headers: {},
  },
};
const MAX_THREAD_COUNT = 8;
const MAX_RETRIES = 8;
const UNLIMITED_RETRIES = -1;
const RETRY_BASE_DELAY_MS = 1200;
const STALL_THRESHOLD_MS = 4000;
const ARCHIVE_EXTENSIONS = new Set([
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv", "mkv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "aac", "m4a", "flac"]);
const IMAGE_PREVIEW_PROFILES = {
  low: { size: 1280, quality: 58 },
  balanced: { size: 1920, quality: 72 },
  high: { size: 2560, quality: 82 },
};
const VIDEO_STREAM_QUALITY_LEVELS = [2160, 1440, 1080, 720, 480, 360];
const VIDEO_TRANSCODE_QUALITY_OPTIONS = [
  "source",
  "360p",
  "480p",
  "720p",
  "1080p",
  "1440p",
  "2160p",
];
const DEFAULT_VIDEO_SEGMENT_SECONDS = 4;
const VIDEO_PRIORITY_WINDOW_SECONDS = 24;
const videoTranscodeStore = new Map();
const MAX_ACTIVE_SESSION_JOBS = 2;
let activeSessionJobCount = 0;
const pendingSessionJobs = [];

app.use(express.json({ limit: "1mb" }));
app.use(express.static(distDir));

function logEvent(level, event, details = {}) {
  const logger =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  const payload = Object.keys(details).length
    ? ` ${JSON.stringify(details)}`
    : "";
  logger(
    `[${new Date().toISOString()}] [${level.toUpperCase()}] ${event}${payload}`,
  );
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function sleepWithSignal(ms, signal) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function sanitizeThreadMode(value) {
  if (value === "single" || value === "segmented" || value === "auto") {
    return value;
  }
  return DEFAULT_DOWNLOAD_SETTINGS.threadMode;
}

function normalizeDownloadSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const threadCount = Math.max(
    1,
    Math.min(
      MAX_THREAD_COUNT,
      Number.parseInt(source.threadCount, 10) ||
        DEFAULT_DOWNLOAD_SETTINGS.threadCount,
    ),
  );
  const requestedRetries = Number.parseInt(source.maxRetries, 10);
  const maxRetries =
    requestedRetries === UNLIMITED_RETRIES
      ? UNLIMITED_RETRIES
      : Math.max(
          0,
          Math.min(
            MAX_RETRIES,
            Number.isFinite(requestedRetries)
              ? requestedRetries
              : DEFAULT_DOWNLOAD_SETTINGS.maxRetries,
          ),
        );

  const videoQuality = VIDEO_TRANSCODE_QUALITY_OPTIONS.includes(
    String(source.videoQuality || "").toLowerCase(),
  )
    ? String(source.videoQuality).toLowerCase()
    : "720p";

  return {
    threadMode: sanitizeThreadMode(source.threadMode),
    threadCount,
    enableMultithread:
      source.enableMultithread == null
        ? DEFAULT_DOWNLOAD_SETTINGS.enableMultithread
        : Boolean(source.enableMultithread),
    enableResume:
      source.enableResume == null
        ? DEFAULT_DOWNLOAD_SETTINGS.enableResume
        : Boolean(source.enableResume),
    maxRetries,
    videoQuality,
  };
}

function normalizeDownloadOptions(input) {
  const source = input && typeof input === "object" ? input : {};
  const flatSource = normalizeDownloadSettings(source);
  const transportSource =
    source.transport && typeof source.transport === "object"
      ? source.transport
      : {};
  const retrySource =
    source.retry && typeof source.retry === "object" ? source.retry : {};
  const mediaSource =
    source.media && typeof source.media === "object" ? source.media : {};
  const extractionSource =
    source.extraction && typeof source.extraction === "object"
      ? source.extraction
      : {};
  const requestSource =
    source.request && typeof source.request === "object" ? source.request : {};

  const timeoutMs = Math.max(
    5000,
    Math.min(180000, Number.parseInt(retrySource.timeoutMs, 10) || 30000),
  );

  const headers =
    requestSource.headers && typeof requestSource.headers === "object"
      ? Object.fromEntries(
          Object.entries(requestSource.headers)
            .filter(([key, value]) => key && value != null)
            .map(([key, value]) => [String(key), String(value)]),
        )
      : {};

  return {
    transport: {
      mode: sanitizeThreadMode(transportSource.mode || flatSource.threadMode),
      threads: Math.max(
        1,
        Math.min(
          MAX_THREAD_COUNT,
          Number.parseInt(transportSource.threads, 10) ||
            flatSource.threadCount,
        ),
      ),
      multithread:
        transportSource.multithread == null
          ? flatSource.enableMultithread
          : Boolean(transportSource.multithread),
      resume:
        transportSource.resume == null
          ? flatSource.enableResume
          : Boolean(transportSource.resume),
    },
    retry: {
      maxRetries:
        Number.parseInt(retrySource.maxRetries, 10) === UNLIMITED_RETRIES
          ? UNLIMITED_RETRIES
          : Math.max(
              0,
              Math.min(
                MAX_RETRIES,
                Number.parseInt(retrySource.maxRetries, 10) ||
                  flatSource.maxRetries,
              ),
            ),
      timeoutMs,
    },
    media: {
      videoQuality: VIDEO_TRANSCODE_QUALITY_OPTIONS.includes(
        String(
          mediaSource.videoQuality || flatSource.videoQuality,
        ).toLowerCase(),
      )
        ? String(
            mediaSource.videoQuality || flatSource.videoQuality,
          ).toLowerCase()
        : DEFAULT_DOWNLOAD_OPTIONS.media.videoQuality,
    },
    extraction: {
      enabled:
        extractionSource.enabled == null
          ? DEFAULT_DOWNLOAD_OPTIONS.extraction.enabled
          : Boolean(extractionSource.enabled),
    },
    request: {
      headers,
    },
  };
}

function downloadOptionsToSettings(options) {
  return {
    threadMode: options.transport.mode,
    threadCount: options.transport.threads,
    enableMultithread: options.transport.multithread,
    enableResume: options.transport.resume,
    maxRetries: options.retry.maxRetries,
    videoQuality: options.media.videoQuality,
  };
}

function isArchiveByName(value) {
  const name = String(value || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return ARCHIVE_EXTENSIONS.has(ext);
}

function classifyDetectedType(filePath, detected) {
  const detectedMime = detected?.mime || mime.lookup(filePath) || "";
  const ext = path.extname(filePath).slice(1).toLowerCase();

  if (
    isArchiveByName(filePath) ||
    String(detectedMime).includes("zip") ||
    String(detectedMime).includes("rar") ||
    String(detectedMime).includes("7z") ||
    String(detectedMime).includes("tar") ||
    String(detectedMime).includes("compressed")
  ) {
    return "archive";
  }

  if (String(detectedMime).startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }

  if (String(detectedMime).startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) {
    return "audio";
  }

  if (String(detectedMime).startsWith("image/")) {
    return "image";
  }

  if (
    String(detectedMime).startsWith("text/") ||
    detectedMime === "application/json"
  ) {
    return "text";
  }

  return "binary";
}

async function fetchRemoteMetadata(url, signal) {
  const headers = {
    "cache-control": "no-cache",
  };

  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal,
      headers,
    });

    if (!response.ok) {
      return {
        size: 0,
        acceptRanges: false,
        etag: "",
        lastModified: "",
      };
    }

    return {
      size: Number(response.headers.get("content-length")) || 0,
      acceptRanges: /bytes/i.test(response.headers.get("accept-ranges") || ""),
      etag: response.headers.get("etag") || "",
      lastModified: response.headers.get("last-modified") || "",
    };
  } catch {
    return {
      size: 0,
      acceptRanges: false,
      etag: "",
      lastModified: "",
    };
  }
}

function classifyMimeType(contentType) {
  if (String(contentType).startsWith("image/")) {
    return "image";
  }
  if (
    String(contentType).startsWith("text/") ||
    contentType === "application/json"
  ) {
    return "text";
  }
  return "binary";
}

function shouldPreserveOriginalPreview(contentType) {
  return contentType === "image/svg+xml" || contentType === "image/gif";
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [rawStart, rawEnd] = rangeHeader.replace("bytes=", "").split("-");
  if (rawStart.includes(",") || rawEnd?.includes(",")) {
    return null;
  }

  let start;
  let end;

  if (rawStart === "") {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function createJob(url, downloadOptions = DEFAULT_DOWNLOAD_OPTIONS) {
  const normalizedOptions = normalizeDownloadOptions(downloadOptions);
  const job = {
    id: crypto.randomUUID(),
    url,
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
    maxRetries: DEFAULT_DOWNLOAD_SETTINGS.maxRetries,
    canResume: false,
    threadMode: DEFAULT_DOWNLOAD_SETTINGS.threadMode,
    threadCount: DEFAULT_DOWNLOAD_SETTINGS.threadCount,
    enableMultithread: DEFAULT_DOWNLOAD_SETTINGS.enableMultithread,
    enableResume: DEFAULT_DOWNLOAD_SETTINGS.enableResume,
    message: "Waiting to start",
    error: "",
    requiresConfirmation: false,
    confirmTokenAccepted: false,
    sessionId: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    transcodedEntries: 0,
    totalTranscodeEntries: 0,
    videoQuality: "720p",
    subscribers: new Set(),
    socketSubscribers: new Set(),
    workspaceDir: "",
    zipPath: "",
    extractDir: "",
    abortController: null,
    cleanupAt: 0,
    downloadOptions: normalizedOptions,
  };

  jobStore.set(job.id, job);
  return job;
}

function sanitizeJob(job) {
  const safeDownloadOptions = job.downloadOptions
    ? {
        ...job.downloadOptions,
        request: {
          ...(job.downloadOptions.request || {}),
          headers: {},
        },
      }
    : null;

  return {
    id: job.id,
    url: job.url,
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
    threadMode: job.threadMode,
    threadCount: job.threadCount,
    enableMultithread: job.enableMultithread,
    enableResume: job.enableResume,
    message: job.message,
    error: job.error,
    requiresConfirmation: job.requiresConfirmation,
    sessionId: job.sessionId,
    transcodedEntries: job.transcodedEntries,
    totalTranscodeEntries: job.totalTranscodeEntries,
    videoQuality: job.videoQuality,
    downloadOptions: safeDownloadOptions,
    updatedAt: job.updatedAt,
  };
}

function scheduleSessionJobs() {
  while (
    activeSessionJobCount < MAX_ACTIVE_SESSION_JOBS &&
    pendingSessionJobs.length > 0
  ) {
    const next = pendingSessionJobs.shift();
    if (!next) {
      break;
    }

    activeSessionJobCount += 1;
    processSessionJob(next.job, next.confirmOversize)
      .catch((error) => {
        logEvent("error", "job.process.unhandled", {
          jobId: next.job.id,
          error: error.message,
          stack: error.stack,
        });
      })
      .finally(() => {
        activeSessionJobCount = Math.max(0, activeSessionJobCount - 1);
        scheduleSessionJobs();
      });
  }
}

function enqueueSessionJob(job, confirmOversize) {
  pendingSessionJobs.push({ job, confirmOversize });
  scheduleSessionJobs();
}

function closeJob(job, terminalStatus) {
  job.status = terminalStatus;
  job.updatedAt = Date.now();
  job.cleanupAt = Date.now() + JOB_TTL_MS;
}

function emitJob(job, patch = {}, eventName = "progress") {
  Object.assign(job, patch, { updatedAt: Date.now() });
  const sanitizedJob = sanitizeJob(job);
  const payload = JSON.stringify(sanitizedJob);
  const socketPayload = JSON.stringify({
    type: eventName,
    job: sanitizedJob,
  });

  for (const res of job.subscribers) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${payload}\n\n`);
    if (isTerminalJobStatus(job.status)) {
      res.end();
    }
  }

  for (const socket of job.socketSubscribers) {
    if (socket.readyState === 1) {
      socket.send(socketPayload);
    }
  }

  if (isTerminalJobStatus(job.status)) {
    job.subscribers.clear();
    job.socketSubscribers.clear();
  }
}

function isTerminalJobStatus(status) {
  return status === "ready" || status === "error" || status === "cancelled";
}

async function cleanupJob(jobId, reason = "cleanup") {
  const job = jobStore.get(jobId);
  if (!job) {
    return;
  }

  if (job.workspaceDir && !job.sessionId) {
    await rm(job.workspaceDir, { recursive: true, force: true }).catch(
      () => {},
    );
  }

  for (const res of job.subscribers) {
    res.end();
  }

  job.subscribers.clear();
  for (const socket of job.socketSubscribers) {
    socket.close(1000, "job-cleanup");
  }
  job.socketSubscribers.clear();
  jobStore.delete(jobId);
  logEvent("info", "job.removed", { jobId, reason });
}

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

function sanitizeEntryPath(entryPath) {
  const normalized = path.posix.normalize(
    String(entryPath || "").replace(/\\/g, "/"),
  );
  const cleaned = normalized.replace(/^\/+/, "").replace(/\/+$/, "");
  if (
    !cleaned ||
    cleaned === "." ||
    cleaned.startsWith("../") ||
    cleaned.includes("/../")
  ) {
    throw new Error(`Unsafe entry path: ${entryPath}`);
  }
  return cleaned;
}

function createNode(name, nodePath, type) {
  return {
    name,
    path: nodePath,
    type,
    extension: type === "file" ? path.extname(name).slice(1).toLowerCase() : "",
    modifiedAt: 0,
    children: type === "directory" ? [] : undefined,
  };
}

function buildTree(entries, rootName) {
  const root = {
    name: rootName,
    path: ".",
    type: "directory",
    parentPath: "",
    modifiedAt: 0,
    children: [],
  };
  const nodes = new Map([[".", root]]);
  let firstFilePath = "";
  let fileCount = 0;

  for (const entry of entries) {
    const parts = entry.relativePath.split("/").filter(Boolean);
    let currentPath = ".";

    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const nextPath = currentPath === "." ? name : `${currentPath}/${name}`;
      const isLeaf = index === parts.length - 1;
      const type = isLeaf && entry.type === "file" ? "file" : "directory";

      if (!nodes.has(nextPath)) {
        const node = createNode(name, nextPath, type);
        node.parentPath = currentPath;
        node.modifiedAt = entry.modifiedAt || 0;
        if (type === "file") {
          node.size = entry.size;
        }
        nodes.set(nextPath, node);
        nodes.get(currentPath).children.push(node);
      } else if (
        entry.modifiedAt &&
        nodes.get(nextPath).modifiedAt < entry.modifiedAt
      ) {
        nodes.get(nextPath).modifiedAt = entry.modifiedAt;
      }

      currentPath = nextPath;
    }

    if (entry.type === "file") {
      fileCount += 1;
      if (!firstFilePath) {
        firstFilePath = entry.relativePath;
      }
    }
  }

  return { tree: root, firstFilePath, stats: { fileCount } };
}

async function removeSession(sessionId, reason = "manual") {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return;
  }

  for (const [key, entry] of videoTranscodeStore.entries()) {
    if (entry.sessionId !== sessionId) {
      continue;
    }

    for (const rendition of entry.renditions.values()) {
      if (rendition.process && !rendition.process.killed) {
        rendition.process.kill("SIGTERM");
      }
    }
    videoTranscodeStore.delete(key);
  }

  sessionStore.delete(sessionId);
  await rm(session.workspaceDir, { recursive: true, force: true });
  logEvent("info", "session.removed", {
    sessionId,
    reason,
    workspaceDir: session.workspaceDir,
  });
}

function touchSession(sessionId) {
  const session = sessionStore.get(sessionId);
  if (session) {
    session.lastAccessedAt = Date.now();
  }
  return session;
}

async function readPreviewChunk(targetPath) {
  const fileHandle = await open(targetPath, "r");
  try {
    const buffer = Buffer.alloc(TEXT_PREVIEW_LIMIT);
    const { bytesRead } = await fileHandle.read(
      buffer,
      0,
      TEXT_PREVIEW_LIMIT,
      0,
    );
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

async function ensureThumbnail(session, normalizedPath, targetPath, size) {
  const safeSize = Math.max(
    48,
    Math.min(Number(size) || 220, MAX_THUMBNAIL_SIZE),
  );
  const hash = crypto
    .createHash("sha1")
    .update(`${normalizedPath}:${safeSize}`)
    .digest("hex");
  const thumbnailDir = path.join(session.workspaceDir, "thumbnails");
  const thumbnailPath = path.join(thumbnailDir, `${hash}.jpg`);

  await mkdir(thumbnailDir, { recursive: true });

  const existing = await stat(thumbnailPath).catch(() => null);
  if (!existing) {
    await sharp(targetPath)
      .rotate()
      .resize({
        width: safeSize,
        height: safeSize,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 55, mozjpeg: true })
      .toFile(thumbnailPath);

    logEvent("info", "session.thumbnail.generated", {
      sessionId: session.id,
      path: normalizedPath,
      size: safeSize,
      thumbnailPath,
    });
  }

  return thumbnailPath;
}

async function ensureImagePreview(
  session,
  normalizedPath,
  targetPath,
  profileName,
) {
  const profile =
    IMAGE_PREVIEW_PROFILES[profileName] || IMAGE_PREVIEW_PROFILES.balanced;
  const hash = crypto
    .createHash("sha1")
    .update(
      `${normalizedPath}:${profileName}:${profile.size}:${profile.quality}`,
    )
    .digest("hex");
  const previewDir = path.join(session.workspaceDir, "previews");
  const previewPath = path.join(previewDir, `${hash}.jpg`);

  await mkdir(previewDir, { recursive: true });

  const existing = await stat(previewPath).catch(() => null);
  if (!existing) {
    await sharp(targetPath)
      .rotate()
      .resize({
        width: profile.size,
        height: profile.size,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#f7f3eb" })
      .jpeg({
        quality: profile.quality,
        mozjpeg: true,
        chromaSubsampling: "4:2:0",
      })
      .toFile(previewPath);

    logEvent("info", "session.image_preview.generated", {
      sessionId: session.id,
      path: normalizedPath,
      profile: profileName,
      previewPath,
    });
  }

  return previewPath;
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      ...options,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(stderr || `Command failed with code ${code}`));
    });
  });
}

async function runCommandCapture(command, args, options = {}) {
  const { allowNonZeroExit = false, ...spawnOptions } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...spawnOptions,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowNonZeroExit) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `Command failed with code ${code}`));
    });
  });
}

async function extractWith7zip(archivePath, extractDir) {
  await runCommand(path7za, ["x", "-y", `-o${extractDir}`, archivePath]);
}

async function detectArchiveEncryption(archivePath) {
  if (!path7za) {
    return false;
  }

  const { stdout } = await runCommandCapture(
    path7za,
    ["l", "-slt", archivePath],
    {
      allowNonZeroExit: true,
    },
  );
  const output = String(stdout || "");
  return (
    /Encrypted\s*=\s*\+/i.test(output) || /Method\s*=\s*\w+\s+AES/i.test(output)
  );
}

async function getVideoDimensions(videoPath) {
  const metadata = await getVideoMetadata(videoPath);
  return {
    width: metadata.width,
    height: metadata.height,
  };
}

function buildVideoQualityOptions(sourceHeight) {
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    return {
      options: [
        { id: "source", label: "Original", height: 0 },
        { id: "720p", label: "720p", height: 720 },
        { id: "480p", label: "480p", height: 480 },
        { id: "360p", label: "360p", height: 360 },
      ],
      defaultQuality: "720p",
    };
  }

  const options = [{ id: "source", label: "Original", height: sourceHeight }];
  for (const level of VIDEO_STREAM_QUALITY_LEVELS) {
    if (level <= sourceHeight) {
      options.push({ id: `${level}p`, label: `${level}p`, height: level });
    }
  }

  const defaultQuality = sourceHeight >= 720 ? "720p" : "source";
  return { options, defaultQuality };
}

function parseDurationSecondsFromStderr(stderr) {
  const durationMatch = String(stderr || "").match(
    /Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/,
  );
  if (!durationMatch) {
    return 0;
  }

  const hours = Number.parseInt(durationMatch[1], 10) || 0;
  const minutes = Number.parseInt(durationMatch[2], 10) || 0;
  const seconds = Number.parseFloat(durationMatch[3]) || 0;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

async function getVideoMetadata(videoPath) {
  if (!ffmpegPath) {
    return { width: 0, height: 0, durationSeconds: 0 };
  }

  try {
    const { stderr } = await runCommandCapture(
      String(ffmpegPath),
      ["-hide_banner", "-i", videoPath],
      {
        allowNonZeroExit: true,
      },
    );
    const lines = stderr.split(/\r?\n/);

    let width = 0;
    let height = 0;
    const streamLine = lines.find(
      (line) => line.includes("Stream #") && line.includes("Video:"),
    );
    if (streamLine) {
      const streamMatch = streamLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
      if (streamMatch) {
        width = Number.parseInt(streamMatch[1], 10) || 0;
        height = Number.parseInt(streamMatch[2], 10) || 0;
      }
    }

    if (!(width > 0 && height > 0)) {
      for (const line of lines) {
        if (!line.includes("Video:")) {
          continue;
        }
        const sizeMatch = line.match(/\b(\d{2,5})x(\d{2,5})\b/);
        if (sizeMatch) {
          width = Number.parseInt(sizeMatch[1], 10) || 0;
          height = Number.parseInt(sizeMatch[2], 10) || 0;
          if (width > 0 && height > 0) {
            break;
          }
        }
      }
    }

    const durationSeconds = parseDurationSecondsFromStderr(stderr);
    return { width, height, durationSeconds };
  } catch {
    return { width: 0, height: 0, durationSeconds: 0 };
  }
}

function getVideoTranscodeKey(sessionId, normalizedPath) {
  return `${sessionId}:${normalizedPath}`;
}

function getRenditionDirectory(session, normalizedPath, qualityId) {
  const hash = crypto
    .createHash("sha1")
    .update(`${session.id}:${normalizedPath}:${qualityId}`)
    .digest("hex");
  return path.join(session.workspaceDir, "video-transcodes", hash);
}

function computeExpectedSegments(durationSeconds) {
  const safeDuration = Number.isFinite(durationSeconds) ? durationSeconds : 0;
  if (safeDuration <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(safeDuration / DEFAULT_VIDEO_SEGMENT_SECONDS));
}

async function countAvailableSegments(rendition) {
  const entries = await readdir(rendition.dir).catch(() => []);
  return entries.filter((entry) => /^segment_\d+\.ts$/i.test(entry)).length;
}

async function ensureVideoTranscodeEntry(session, normalizedPath, targetPath) {
  const key = getVideoTranscodeKey(session.id, normalizedPath);
  let entry = videoTranscodeStore.get(key);
  if (entry) {
    return entry;
  }

  const metadata = await getVideoMetadata(targetPath);
  const qualityConfig = buildVideoQualityOptions(metadata.height);
  entry = {
    sessionId: session.id,
    path: normalizedPath,
    targetPath,
    durationSeconds: metadata.durationSeconds,
    width: metadata.width,
    height: metadata.height,
    expectedSegments: computeExpectedSegments(metadata.durationSeconds),
    qualities: qualityConfig.options,
    defaultQuality: qualityConfig.defaultQuality,
    renditions: new Map(),
  };
  videoTranscodeStore.set(key, entry);
  return entry;
}

function getRenditionState(entry, session, qualityId) {
  let rendition = entry.renditions.get(qualityId);
  if (rendition) {
    return rendition;
  }

  const qualityOption = entry.qualities.find(
    (option) => option.id === qualityId,
  );
  const selectedHeight =
    qualityId === "source"
      ? 0
      : Number.parseInt(qualityId.replace("p", ""), 10) ||
        Number(qualityOption?.height) ||
        0;

  rendition = {
    qualityId,
    selectedHeight,
    dir: getRenditionDirectory(session, entry.path, qualityId),
    playlistPath: "",
    status: "idle",
    process: null,
    priorityJobs: new Map(),
    availableSegments: 0,
    expectedSegments: entry.expectedSegments,
    durationSeconds: entry.durationSeconds,
  };

  entry.renditions.set(qualityId, rendition);
  return rendition;
}

async function refreshRenditionAvailability(rendition) {
  rendition.availableSegments = await countAvailableSegments(rendition);
  return rendition.availableSegments;
}

async function waitForFile(filePath, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const exists = await access(filePath)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
  }

  return false;
}

function buildTranscodeArgs(targetPath, selectedHeight, outputPattern) {
  const args = ["-hide_banner", "-loglevel", "error", "-i", targetPath];

  if (selectedHeight > 0) {
    args.push("-vf", `scale=-2:${selectedHeight}`);
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    selectedHeight >= 1440 ? "27" : selectedHeight >= 1080 ? "26" : "24",
    "-c:a",
    "aac",
    "-f",
    "segment",
    "-segment_time",
    String(DEFAULT_VIDEO_SEGMENT_SECONDS),
    "-segment_format",
    "mpegts",
    "-reset_timestamps",
    "1",
    outputPattern,
  );

  return args;
}

async function startRenditionTranscode(entry, session, rendition) {
  if (!ffmpegPath) {
    return;
  }

  if (rendition.status === "running" || rendition.status === "done") {
    return;
  }

  await mkdir(rendition.dir, { recursive: true });
  const outputPattern = path.join(rendition.dir, "segment_%06d.ts");
  rendition.status = "running";
  const child = spawn(
    String(ffmpegPath),
    buildTranscodeArgs(
      entry.targetPath,
      rendition.selectedHeight,
      outputPattern,
    ),
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  rendition.process = child;

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  child.on("close", async (code) => {
    rendition.process = null;
    await refreshRenditionAvailability(rendition);
    rendition.status = code === 0 ? "done" : "error";
    if (code !== 0) {
      logEvent("warn", "video.transcode.failed", {
        sessionId: session.id,
        path: entry.path,
        quality: rendition.qualityId,
        code,
        stderr: stderr.slice(-500),
      });
    }
  });
}

async function startPrioritySegmentWindow(
  entry,
  session,
  rendition,
  segmentIndex,
) {
  if (!ffmpegPath || segmentIndex < 0) {
    return;
  }

  if (rendition.priorityJobs.has(segmentIndex)) {
    return rendition.priorityJobs.get(segmentIndex);
  }

  const promise = (async () => {
    await mkdir(rendition.dir, { recursive: true });
    const segmentPath = path.join(
      rendition.dir,
      `segment_${String(segmentIndex).padStart(6, "0")}.ts`,
    );
    const alreadyExists = await access(segmentPath)
      .then(() => true)
      .catch(() => false);
    if (alreadyExists) {
      return;
    }

    const seekSeconds = Math.max(
      0,
      segmentIndex * DEFAULT_VIDEO_SEGMENT_SECONDS,
    );
    const outputPattern = path.join(rendition.dir, "segment_%06d.ts");
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seekSeconds),
      "-i",
      entry.targetPath,
    ];

    if (rendition.selectedHeight > 0) {
      args.push("-vf", `scale=-2:${rendition.selectedHeight}`);
    }

    args.push(
      "-t",
      String(VIDEO_PRIORITY_WINDOW_SECONDS),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      rendition.selectedHeight >= 1080 ? "26" : "24",
      "-c:a",
      "aac",
      "-f",
      "segment",
      "-segment_time",
      String(DEFAULT_VIDEO_SEGMENT_SECONDS),
      "-segment_start_number",
      String(segmentIndex),
      "-segment_format",
      "mpegts",
      "-reset_timestamps",
      "1",
      outputPattern,
    );

    await runCommand(String(ffmpegPath), args).catch(() => {});
    await refreshRenditionAvailability(rendition);
  })();

  rendition.priorityJobs.set(segmentIndex, promise);
  promise.finally(() => {
    rendition.priorityJobs.delete(segmentIndex);
  });
  return promise;
}

function getSessionQualityOutputPath(session, normalizedPath, quality) {
  const safeQuality = String(quality || "720p").toLowerCase();
  const outputRelative = normalizedPath.replace(/\.[^.]+$/, ".mp4");
  return path.join(
    session.workspaceDir,
    "quality",
    safeQuality,
    outputRelative,
  );
}

async function downloadWithAria2({
  url,
  targetPath,
  signal,
  settings,
  state,
  metadata,
  confirmOversize,
}) {
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

async function listExtractedEntries(
  rootDir,
  currentDir = rootDir,
  entries = [],
) {
  const dirEntries = await readdir(currentDir, { withFileTypes: true });
  for (const dirEntry of dirEntries) {
    const fullPath = path.join(currentDir, dirEntry.name);
    const relativePath = path
      .relative(rootDir, fullPath)
      .split(path.sep)
      .join("/");
    const details = await stat(fullPath);
    if (dirEntry.isDirectory()) {
      entries.push({
        relativePath,
        type: "directory",
        size: 0,
        modifiedAt: details.mtimeMs,
      });
      await listExtractedEntries(rootDir, fullPath, entries);
    } else if (dirEntry.isFile()) {
      entries.push({
        relativePath,
        type: "file",
        size: details.size,
        modifiedAt: details.mtimeMs,
      });
    }
  }
  return entries;
}

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      removeSession(sessionId, "expired").catch((error) => {
        logEvent("error", "session.cleanup.failed", {
          sessionId,
          error: error.message,
          stack: error.stack,
        });
      });
    }
  }

  for (const [jobId, job] of jobStore.entries()) {
    if (job.cleanupAt && now > job.cleanupAt) {
      cleanupJob(jobId, "expired").catch((error) => {
        logEvent("error", "job.cleanup.failed", {
          jobId,
          error: error.message,
          stack: error.stack,
        });
      });
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

async function shutdown() {
  if (isShuttingDown) {
    logEvent("warn", "shutdown.duplicate_signal_ignored");
    return;
  }

  isShuttingDown = true;
  logEvent("info", "shutdown.start", { activeSessions: sessionStore.size });
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    logEvent("info", "server.stopped_accepting_requests");
  }

  await Promise.all(
    [...sessionStore.keys()].map((sessionId) =>
      removeSession(sessionId, "shutdown"),
    ),
  );
  await Promise.all(
    [...jobStore.keys()].map((jobId) => cleanupJob(jobId, "shutdown")),
  );
  logEvent("info", "shutdown.complete", { activeSessions: sessionStore.size });
  process.exit(0);
}

process.on("SIGTERM", () => {
  logEvent("info", "signal.received", { signal: "SIGTERM" });
  shutdown().catch((error) => {
    logEvent("error", "shutdown.failed", {
      signal: "SIGTERM",
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  logEvent("info", "signal.received", { signal: "SIGINT" });
  shutdown().catch((error) => {
    logEvent("error", "shutdown.failed", {
      signal: "SIGINT",
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, sessions: sessionStore.size, jobs: jobStore.size });
});

function isRetryableDownloadError(error) {
  if (!error) {
    return false;
  }

  if (error.name === "AbortError") {
    return false;
  }

  if (error.code === "OVERSIZE_CONFIRM") {
    return false;
  }

  if (error.code === "DOWNLOAD_FATAL") {
    return false;
  }

  if (error.statusCode) {
    if (error.statusCode >= 500) {
      return true;
    }

    return error.statusCode === 408 || error.statusCode === 429;
  }

  return true;
}

async function processSessionJob(job, confirmOversize = false) {
  const { url } = job;

  if (!url) {
    throw new Error("File URL is required.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Enter a valid public URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }

  const workspaceDir = await mkdtemp(
    path.join(os.tmpdir(), "zip-image-viewer-"),
  );
  const requestedName = path.basename(parsedUrl.pathname) || "download.bin";
  const zipPath = path.join(workspaceDir, requestedName);
  const extractDir = path.join(workspaceDir, "extracted");
  await mkdir(extractDir, { recursive: true });
  job.workspaceDir = workspaceDir;
  job.zipPath = zipPath;
  job.extractDir = extractDir;
  job.abortController = new AbortController();

  const settings = downloadOptionsToSettings(job.downloadOptions);
  job.maxRetries = settings.maxRetries;
  job.threadMode = settings.threadMode;
  job.threadCount = settings.threadCount;
  job.enableMultithread = settings.enableMultithread;
  job.enableResume = settings.enableResume;
  job.videoQuality = settings.videoQuality;

  const downloadState = {
    downloadedBytes: 0,
    reportedSize: 0,
    statusText: "Starting archive download",
  };

  const monitor = createDownloadProgressMonitor({
    job,
    emitJob,
    progressEmitIntervalMs: PROGRESS_EMIT_INTERVAL_MS,
    stallThresholdMs: STALL_THRESHOLD_MS,
    state: {
      getDownloadedBytes: () => downloadState.downloadedBytes,
      getReportedSize: () => downloadState.reportedSize,
      phase: () => job.phase,
      status: () => job.status,
      getMessage: ({ currentBytes, reportedSize, isStalled }) => {
        if (downloadState.statusText) {
          return downloadState.statusText;
        }

        if (isStalled) {
          return "Download appears stalled. Waiting for more data...";
        }

        if (reportedSize > 0) {
          return `Downloading archive: ${formatBytes(currentBytes)} of ${formatBytes(reportedSize)}`;
        }

        return `Downloading archive: ${formatBytes(currentBytes)} received`;
      },
    },
  });

  try {
    emitJob(job, {
      status: "downloading",
      phase: "downloading",
      retryCount: 0,
      downloadSpeedBytesPerSec: 0,
      averageSpeedBytesPerSec: 0,
      etaSeconds: null,
      isStalled: false,
      stallDurationMs: 0,
      message: "Starting archive download",
      error: "",
    });
    logEvent("info", "session.create.start", {
      jobId: job.id,
      url,
      confirmOversize,
      workspaceDir,
      settings,
    });

    const metadata = await fetchRemoteMetadata(url, job.abortController.signal);
    downloadState.reportedSize = metadata.size;
    if (metadata.size > CONFIRM_SIZE_BYTES && !confirmOversize) {
      await rm(workspaceDir, { recursive: true, force: true });
      emitJob(
        job,
        {
          status: "awaiting_confirmation",
          phase: "confirm",
          requiresConfirmation: true,
          reportedSize: metadata.size,
          downloadSpeedBytesPerSec: 0,
          averageSpeedBytesPerSec: 0,
          etaSeconds: null,
          message: `Archive is ${formatBytes(metadata.size)} and needs confirmation before download.`,
        },
        "confirmation",
      );
      closeJob(job, "awaiting_confirmation");
      return;
    }

    let resolvedMode = settings.threadMode;
    if (resolvedMode === "auto") {
      resolvedMode =
        settings.enableMultithread && metadata.acceptRanges && metadata.size > 0
          ? "segmented"
          : "single";
    }
    if (resolvedMode === "segmented" && !settings.enableMultithread) {
      resolvedMode = "single";
    }

    const resolvedThreadCount =
      resolvedMode === "segmented" ? Math.max(1, settings.threadCount) : 1;
    job.threadMode = resolvedMode;
    job.threadCount = resolvedThreadCount;
    job.canResume =
      settings.enableResume &&
      (metadata.acceptRanges || resolvedMode === "segmented");

    const segments = [];
    monitor.start();

    for (
      let attempt = 0;
      settings.maxRetries === UNLIMITED_RETRIES ||
      attempt <= settings.maxRetries;
      attempt += 1
    ) {
      job.retryCount = attempt;
      const retriesLabel =
        settings.maxRetries === UNLIMITED_RETRIES
          ? "∞"
          : String(settings.maxRetries);
      downloadState.statusText =
        attempt === 0
          ? "Starting archive download"
          : `Retrying download (attempt ${attempt}/${retriesLabel})`;
      monitor.flush();

      try {
        downloadState.statusText = "";
        await downloadWithAria2({
          url,
          targetPath: zipPath,
          signal: job.abortController.signal,
          settings,
          state: downloadState,
          metadata,
          confirmOversize,
        });
        break;
      } catch (error) {
        if (
          error.code === "RANGE_UNSUPPORTED" &&
          settings.threadMode === "auto"
        ) {
          resolvedMode = "single";
          job.threadMode = "single";
          job.threadCount = 1;
          job.canResume = settings.enableResume && metadata.acceptRanges;
          downloadState.downloadedBytes = 0;
          segments.length = 0;
          continue;
        }

        if (error.code === "OVERSIZE_CONFIRM") {
          monitor.stop();
          await rm(workspaceDir, { recursive: true, force: true });
          emitJob(
            job,
            {
              status: "awaiting_confirmation",
              phase: "confirm",
              requiresConfirmation: true,
              reportedSize: downloadState.downloadedBytes,
              downloadedBytes: downloadState.downloadedBytes,
              percent: null,
              downloadSpeedBytesPerSec: 0,
              averageSpeedBytesPerSec: 0,
              etaSeconds: null,
              message: `Archive exceeded ${formatBytes(CONFIRM_SIZE_BYTES)} and needs confirmation to continue.`,
            },
            "confirmation",
          );
          closeJob(job, "awaiting_confirmation");
          return;
        }

        if (
          (settings.maxRetries !== UNLIMITED_RETRIES &&
            attempt >= settings.maxRetries) ||
          !isRetryableDownloadError(error)
        ) {
          throw error;
        }

        const delayMs =
          RETRY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 400);
        downloadState.statusText = `Download failed, retrying in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${retriesLabel})`;
        monitor.flush();
        await sleepWithSignal(delayMs, job.abortController.signal);
      }
    }

    downloadState.statusText =
      "Archive download complete. Preparing extraction...";
    monitor.flush();
    monitor.stop();

    emitJob(job, {
      downloadedBytes: downloadState.downloadedBytes,
      reportedSize: downloadState.reportedSize,
      percent: 100,
      downloadSpeedBytesPerSec: 0,
      averageSpeedBytesPerSec: 0,
      etaSeconds: 0,
      isStalled: false,
      stallDurationMs: 0,
      message: "Archive download complete. Preparing extraction...",
    });
    logEvent("info", "download.complete", {
      jobId: job.id,
      url,
      downloadedBytes: downloadState.downloadedBytes,
      downloadedLabel: formatBytes(downloadState.downloadedBytes),
      zipPath,
      mode: job.threadMode,
      threadCount: job.threadCount,
      retries: job.retryCount,
    });

    const detected = await fileTypeFromFile(zipPath).catch(() => null);
    const detectedKind = classifyDetectedType(zipPath, detected);
    const extractedEntries = [];
    const extractRootPath = path.resolve(extractDir);
    let lastExtractEmitAt = Date.now();

    function emitExtractionProgress(force = false) {
      const now = Date.now();
      if (!force && now - lastExtractEmitAt < PROGRESS_EMIT_INTERVAL_MS) {
        return;
      }

      const safeTotal = Math.max(1, extractedEntries.length || 1);
      const extractPercent = Math.floor(
        (extractedEntries.length / safeTotal) * 100,
      );
      emitJob(job, {
        extractedEntries: extractedEntries.length,
        totalEntries: safeTotal,
        percent: Math.min(extractPercent, 100),
        downloadSpeedBytesPerSec: 0,
        averageSpeedBytesPerSec: 0,
        etaSeconds: null,
        isStalled: false,
        stallDurationMs: 0,
        message: `Extracting archive: ${extractedEntries.length} of ${safeTotal} entries`,
      });
      lastExtractEmitAt = now;
    }

    if (detectedKind === "archive") {
      const archiveEncrypted = await detectArchiveEncryption(zipPath).catch(
        () => false,
      );
      if (archiveEncrypted) {
        throw new Error(
          "Password-protected archives are not currently supported in this flow.",
        );
      }

      emitJob(job, {
        status: "extracting",
        phase: "extracting",
        totalEntries: 0,
        extractedEntries: 0,
        percent: 0,
        downloadSpeedBytesPerSec: 0,
        averageSpeedBytesPerSec: 0,
        etaSeconds: null,
        isStalled: false,
        stallDurationMs: 0,
        message: "Extracting archive",
      });

      if (isArchiveByName(zipPath) && !/\.zip$/i.test(zipPath)) {
        await extractWith7zip(zipPath, extractDir);
        const entries = await listExtractedEntries(extractDir);
        extractedEntries.push(...entries);
      } else {
        const directory = await unzipper.Open.file(zipPath);
        for (const entry of directory.files) {
          const relativePath = sanitizeEntryPath(entry.path);
          const destination = path.join(extractDir, relativePath);
          const resolved = path.resolve(destination);

          if (
            !resolved.startsWith(`${extractRootPath}${path.sep}`) &&
            resolved !== extractRootPath
          ) {
            throw new Error("Archive contains invalid file paths.");
          }

          if (entry.type === "Directory") {
            await mkdir(destination, { recursive: true });
            extractedEntries.push({
              relativePath,
              type: "directory",
              size: 0,
              modifiedAt: entry.lastModifiedDateTime?.getTime() || 0,
            });
            emitExtractionProgress(false);
            continue;
          }

          await mkdir(path.dirname(destination), { recursive: true });
          await pipeline(entry.stream(), createWriteStream(destination));
          extractedEntries.push({
            relativePath,
            type: "file",
            size: entry.uncompressedSize || 0,
            modifiedAt: entry.lastModifiedDateTime?.getTime() || 0,
          });

          emitExtractionProgress(false);
        }
      }
    } else {
      const mediaDir = path.join(extractDir, "direct");
      await mkdir(mediaDir, { recursive: true });
      const mediaPath = path.join(mediaDir, path.basename(zipPath));
      await rename(zipPath, mediaPath);
      extractedEntries.push({
        relativePath: `direct/${path.basename(zipPath)}`,
        type: "file",
        size: (await stat(mediaPath)).size,
        modifiedAt: Date.now(),
      });
    }

    emitExtractionProgress(true);

    const archiveName = path.basename(parsedUrl.pathname) || "download";
    const rootName =
      archiveName.replace(/\.(zip|rar|7z|tar|gz|tgz)$/i, "") || archiveName;
    const { tree, firstFilePath, stats } = buildTree(
      extractedEntries,
      rootName,
    );
    const sessionId = crypto.randomUUID();
    const directoryCount = extractedEntries.length - stats.fileCount;

    logEvent("info", "extract.complete", {
      jobId: job.id,
      url,
      entryCount: extractedEntries.length,
      fileCount: stats.fileCount,
      directoryCount,
      firstFilePath,
    });

    sessionStore.set(sessionId, {
      id: sessionId,
      workspaceDir,
      extractDir,
      tree,
      firstFilePath,
      stats,
      selectedVideoQuality: "720p",
      transcodeStatus: {
        quality: "720p",
        done: true,
        completed: 0,
        total: 0,
      },
      lastAccessedAt: Date.now(),
    });

    logEvent("info", "session.create.complete", {
      jobId: job.id,
      sessionId,
      url,
      fileCount: stats.fileCount,
      firstFilePath,
    });

    const videoEntries = extractedEntries.filter((entry) => {
      if (entry.type !== "file") {
        return false;
      }
      const ext = path.extname(entry.relativePath).slice(1).toLowerCase();
      return VIDEO_EXTENSIONS.has(ext);
    });

    const session = sessionStore.get(sessionId);
    session.transcodeStatus = {
      quality: "720p",
      done: true,
      completed: 0,
      total: videoEntries.length,
    };

    job.workspaceDir = "";
    job.extractDir = "";
    job.zipPath = "";

    emitJob(
      job,
      {
        status: "ready",
        phase: "ready",
        sessionId,
        percent: 100,
        downloadSpeedBytesPerSec: 0,
        averageSpeedBytesPerSec: 0,
        etaSeconds: 0,
        isStalled: false,
        stallDurationMs: 0,
        message: "Archive is ready to browse.",
        requiresConfirmation: false,
      },
      "ready",
    );
    closeJob(job, "ready");
  } catch (error) {
    monitor.stop();
    await rm(workspaceDir, { recursive: true, force: true });
    logEvent("error", "session.create.failed", {
      jobId: job.id,
      url,
      error: error.message,
      stack: error.stack,
    });

    if (error.name === "AbortError") {
      emitJob(
        job,
        {
          status: "cancelled",
          phase: "cancelled",
          error: "",
          downloadSpeedBytesPerSec: 0,
          averageSpeedBytesPerSec: 0,
          etaSeconds: null,
          isStalled: false,
          stallDurationMs: 0,
          message: "Archive loading was cancelled.",
        },
        "cancelled",
      );
      closeJob(job, "cancelled");
      return;
    }

    emitJob(
      job,
      {
        status: "error",
        phase: "error",
        error: error.message || "Could not process this file.",
        downloadSpeedBytesPerSec: 0,
        averageSpeedBytesPerSec: 0,
        etaSeconds: null,
        isStalled: false,
        stallDurationMs: 0,
        message: error.message || "Could not process this file.",
      },
      "job-error",
    );
    closeJob(job, "error");
  }
}

app.post("/api/sessions", async (req, res) => {
  const {
    url,
    confirmOversize = false,
    downloadOptions = null,
    downloadSettings = null,
  } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: "File URL is required." });
  }
  const job = createJob(url, downloadOptions || downloadSettings || {});

  emitJob(job, { message: "Queued archive request" });
  enqueueSessionJob(job, confirmOversize);

  return res.status(202).json({ jobId: job.id, ...sanitizeJob(job) });
});

app.get("/api/session-jobs/:id", (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  return res.json(sanitizeJob(job));
});

app.get("/api/session-jobs/:id/events", (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache, no-transform");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders?.();

  job.subscribers.add(res);
  res.write("retry: 1500\n\n");
  res.write(`event: progress\n`);
  res.write(`data: ${JSON.stringify(sanitizeJob(job))}\n\n`);

  req.on("close", () => {
    job.subscribers.delete(res);
  });
});

app.post("/api/session-jobs/:id/confirm", (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  if (job.status !== "awaiting_confirmation") {
    return res.status(400).json({ error: "Job is not awaiting confirmation." });
  }

  if (!job.requiresConfirmation) {
    return res
      .status(400)
      .json({ error: "This job does not need confirmation." });
  }

  job.requiresConfirmation = false;
  job.cleanupAt = 0;
  enqueueSessionJob(job, true);

  return res.json(sanitizeJob(job));
});

app.get("/api/session-jobs/:id/stream", async (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  if (!job.zipPath) {
    return res.status(409).json({
      error: "Streaming source is not ready yet.",
    });
  }

  const fileStats = await stat(job.zipPath).catch(() => null);
  if (!fileStats || !fileStats.isFile() || fileStats.size <= 0) {
    return res.status(409).json({
      error: "No downloaded bytes available yet.",
    });
  }

  let contentType = "application/octet-stream";
  try {
    const parsedUrl = new URL(job.url);
    contentType = mime.lookup(parsedUrl.pathname) || contentType;
  } catch {
    contentType = mime.lookup(job.zipPath) || contentType;
  }

  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "no-store");
  res.type(contentType);

  const range = parseRangeHeader(req.headers.range, fileStats.size);
  if (range === "invalid") {
    res.setHeader("content-range", `bytes */${fileStats.size}`);
    return res.status(416).end();
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    res.status(206);
    res.setHeader(
      "content-range",
      `bytes ${range.start}-${range.end}/${fileStats.size}`,
    );
    res.setHeader("content-length", String(contentLength));
    return createReadStream(job.zipPath, {
      start: range.start,
      end: range.end,
    }).pipe(res);
  }

  res.setHeader("content-length", String(fileStats.size));
  return createReadStream(job.zipPath).pipe(res);
});

app.delete("/api/session-jobs/:id", async (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  job.abortController?.abort();
  emitJob(
    job,
    {
      status: "cancelled",
      phase: "cancelled",
      error: "",
      downloadSpeedBytesPerSec: 0,
      message: "Archive loading was cancelled.",
    },
    "cancelled",
  );
  closeJob(job, "cancelled");
  await cleanupJob(job.id, "cancelled");
  return res.status(204).end();
});

app.get("/api/sessions/:id/tree", (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    logEvent("warn", "session.tree.missing", { sessionId: req.params.id });
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  logEvent("info", "session.tree.read", {
    sessionId: session.id,
    fileCount: session.stats.fileCount,
  });

  return res.json({
    id: session.id,
    tree: session.tree,
    firstFilePath: session.firstFilePath,
    stats: session.stats,
  });
});

app.get("/api/sessions/:id/video/play", async (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  const requestedPath = String(req.query.path || "");
  const quality = String(
    req.query.quality || session.selectedVideoQuality || "720p",
  ).toLowerCase();
  if (!requestedPath || requestedPath === ".") {
    return res.status(400).json({ error: "File path is required." });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const rawPath = path.resolve(path.join(session.extractDir, normalizedPath));
  const rootPath = path.resolve(session.extractDir);
  if (!rawPath.startsWith(`${rootPath}${path.sep}`) && rawPath !== rootPath) {
    return res.status(400).json({ error: "Invalid file path." });
  }

  const rawStats = await stat(rawPath).catch(() => null);
  if (!rawStats || !rawStats.isFile()) {
    return res.status(404).json({ error: "File not found." });
  }

  let targetPath = rawPath;
  let targetStats = rawStats;
  let sourceMode = "raw";
  if (quality !== "source") {
    const qualityPath = getSessionQualityOutputPath(
      session,
      normalizedPath,
      quality,
    );
    const qualityStats = await stat(qualityPath).catch(() => null);
    if (qualityStats?.isFile()) {
      targetPath = qualityPath;
      targetStats = qualityStats;
      sourceMode = quality;
    }
  }

  res.setHeader("cache-control", "no-store");
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("x-video-source", sourceMode);
  res.type(mime.lookup(targetPath) || "video/mp4");

  const range = parseRangeHeader(req.headers.range, targetStats.size);
  if (range === "invalid") {
    res.setHeader("content-range", `bytes */${targetStats.size}`);
    return res.status(416).end();
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    res.status(206);
    res.setHeader(
      "content-range",
      `bytes ${range.start}-${range.end}/${targetStats.size}`,
    );
    res.setHeader("content-length", String(contentLength));
    return createReadStream(targetPath, {
      start: range.start,
      end: range.end,
    }).pipe(res);
  }

  res.setHeader("content-length", String(targetStats.size));
  return createReadStream(targetPath).pipe(res);
});

app.get("/api/sessions/:id/video/transcode-status", (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  return res.json({
    quality: session.selectedVideoQuality || "720p",
    ...(session.transcodeStatus || {
      done: true,
      completed: 0,
      total: 0,
    }),
  });
});

app.get("/api/sessions/:id/video/qualities", async (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  const requestedPath = String(req.query.path || "");
  if (!requestedPath || requestedPath === ".") {
    return res.status(400).json({ error: "File path is required." });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const targetPath = path.resolve(
    path.join(session.extractDir, normalizedPath),
  );
  const rootPath = path.resolve(session.extractDir);
  if (
    !targetPath.startsWith(`${rootPath}${path.sep}`) &&
    targetPath !== rootPath
  ) {
    return res.status(400).json({ error: "Invalid file path." });
  }

  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats || !fileStats.isFile()) {
    return res.status(404).json({ error: "File not found." });
  }

  const contentType = mime.lookup(targetPath) || "application/octet-stream";
  const extension = path.extname(targetPath).slice(1).toLowerCase();
  if (
    !String(contentType).startsWith("video/") &&
    !VIDEO_EXTENSIONS.has(extension)
  ) {
    return res.status(400).json({ error: "Selected file is not a video." });
  }

  const source = await getVideoMetadata(targetPath);
  const qualityConfig = buildVideoQualityOptions(source.height);
  const options = qualityConfig.options;
  const preferredQuality =
    session.selectedVideoQuality || qualityConfig.defaultQuality;
  const defaultQuality =
    options.find((option) => option.id === preferredQuality)?.id ||
    qualityConfig.defaultQuality;

  return res.json({
    path: normalizedPath,
    source,
    options,
    defaultQuality,
  });
});

app.get("/api/sessions/:id/video/hls/playlist", async (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  if (!ffmpegPath) {
    return res.status(503).json({ error: "Video transcoder is unavailable." });
  }

  const requestedPath = String(req.query.path || "");
  const requestedQuality = String(req.query.quality || "720p").toLowerCase();
  if (!requestedPath || requestedPath === ".") {
    return res.status(400).json({ error: "File path is required." });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const targetPath = path.resolve(
    path.join(session.extractDir, normalizedPath),
  );
  const rootPath = path.resolve(session.extractDir);
  if (
    !targetPath.startsWith(`${rootPath}${path.sep}`) &&
    targetPath !== rootPath
  ) {
    return res.status(400).json({ error: "Invalid file path." });
  }

  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats || !fileStats.isFile()) {
    return res.status(404).json({ error: "File not found." });
  }

  const entry = await ensureVideoTranscodeEntry(
    session,
    normalizedPath,
    targetPath,
  );
  const selectedQuality =
    entry.qualities.find((option) => option.id === requestedQuality)?.id ||
    entry.defaultQuality ||
    "720p";
  const rendition = getRenditionState(entry, session, selectedQuality);
  await startRenditionTranscode(entry, session, rendition);
  await refreshRenditionAvailability(rendition);

  const segmentCount = Math.max(1, rendition.expectedSegments || 1);
  const targetDuration = Math.max(1, DEFAULT_VIDEO_SEGMENT_SECONDS);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ];

  for (let index = 0; index < segmentCount; index += 1) {
    const remaining =
      entry.durationSeconds - index * DEFAULT_VIDEO_SEGMENT_SECONDS;
    const duration =
      index === segmentCount - 1
        ? Math.max(
            0.2,
            remaining > 0 ? remaining : DEFAULT_VIDEO_SEGMENT_SECONDS,
          )
        : DEFAULT_VIDEO_SEGMENT_SECONDS;
    lines.push(`#EXTINF:${duration.toFixed(3)},`);
    lines.push(
      `/api/sessions/${session.id}/video/hls/segment?${new URLSearchParams({
        path: normalizedPath,
        quality: selectedQuality,
        index: String(index),
      }).toString()}`,
    );
  }

  if (rendition.status === "done") {
    lines.push("#EXT-X-ENDLIST");
  }

  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/vnd.apple.mpegurl");
  res.setHeader("x-video-duration-seconds", String(entry.durationSeconds || 0));
  return res.send(`${lines.join("\n")}\n`);
});

app.get("/api/sessions/:id/video/hls/segment", async (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  if (!ffmpegPath) {
    return res.status(503).json({ error: "Video transcoder is unavailable." });
  }

  const requestedPath = String(req.query.path || "");
  const requestedQuality = String(req.query.quality || "720p").toLowerCase();
  const segmentIndex = Math.max(
    0,
    Number.parseInt(String(req.query.index || "0"), 10) || 0,
  );
  if (!requestedPath || requestedPath === ".") {
    return res.status(400).json({ error: "File path is required." });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const targetPath = path.resolve(
    path.join(session.extractDir, normalizedPath),
  );
  const rootPath = path.resolve(session.extractDir);
  if (
    !targetPath.startsWith(`${rootPath}${path.sep}`) &&
    targetPath !== rootPath
  ) {
    return res.status(400).json({ error: "Invalid file path." });
  }

  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats || !fileStats.isFile()) {
    return res.status(404).json({ error: "File not found." });
  }

  const entry = await ensureVideoTranscodeEntry(
    session,
    normalizedPath,
    targetPath,
  );
  const selectedQuality =
    entry.qualities.find((option) => option.id === requestedQuality)?.id ||
    entry.defaultQuality ||
    "720p";
  const rendition = getRenditionState(entry, session, selectedQuality);
  await startRenditionTranscode(entry, session, rendition);

  const segmentPath = path.join(
    rendition.dir,
    `segment_${String(segmentIndex).padStart(6, "0")}.ts`,
  );
  let exists = await access(segmentPath)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    await startPrioritySegmentWindow(entry, session, rendition, segmentIndex);
    exists = await waitForFile(segmentPath, 14000);
  }

  if (!exists) {
    return res.status(425).json({
      error: "Segment is being prepared.",
      status: rendition.status,
      availableSegments: rendition.availableSegments,
      requestedSegment: segmentIndex,
    });
  }

  await refreshRenditionAvailability(rendition);
  res.setHeader("cache-control", "no-store");
  res.setHeader("accept-ranges", "bytes");
  res.type("video/mp2t");
  return createReadStream(segmentPath).pipe(res);
});

app.get("/api/sessions/:id/video/hls/status", async (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  const requestedPath = String(req.query.path || "");
  if (!requestedPath || requestedPath === ".") {
    return res.status(400).json({ error: "File path is required." });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const key = getVideoTranscodeKey(session.id, normalizedPath);
  const entry = videoTranscodeStore.get(key);
  if (!entry) {
    return res.json({
      path: normalizedPath,
      status: "idle",
      durationSeconds: 0,
      renditions: [],
    });
  }

  const renditions = [];
  for (const [qualityId, rendition] of entry.renditions.entries()) {
    const availableSegments = await refreshRenditionAvailability(rendition);
    renditions.push({
      quality: qualityId,
      status: rendition.status,
      availableSegments,
      expectedSegments: rendition.expectedSegments,
    });
  }

  return res.json({
    path: normalizedPath,
    status: renditions.some((item) => item.status === "running")
      ? "running"
      : renditions.some((item) => item.status === "done")
        ? "ready"
        : "idle",
    durationSeconds: entry.durationSeconds,
    renditions,
  });
});

app.get("/api/sessions/:id/video/stream", async (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  if (!ffmpegPath) {
    return res.status(503).json({ error: "Video transcoder is unavailable." });
  }

  const requestedPath = String(req.query.path || "");
  const quality = String(req.query.quality || "source").toLowerCase();
  if (!requestedPath || requestedPath === ".") {
    return res.status(400).json({ error: "File path is required." });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const targetPath = path.resolve(
    path.join(session.extractDir, normalizedPath),
  );
  const rootPath = path.resolve(session.extractDir);
  if (
    !targetPath.startsWith(`${rootPath}${path.sep}`) &&
    targetPath !== rootPath
  ) {
    return res.status(400).json({ error: "Invalid file path." });
  }

  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats || !fileStats.isFile()) {
    return res.status(404).json({ error: "File not found." });
  }

  const sourceDimensions = await getVideoDimensions(targetPath);
  const { options } = buildVideoQualityOptions(sourceDimensions.height);
  const selectedQuality =
    options.find((option) => option.id === quality)?.id || "source";
  const selectedHeight =
    selectedQuality === "source"
      ? 0
      : Number.parseInt(selectedQuality.replace("p", ""), 10) || 0;

  const ffmpegArgs = ["-hide_banner", "-loglevel", "error", "-i", targetPath];

  if (selectedHeight > 0) {
    ffmpegArgs.push("-vf", `scale=-2:${selectedHeight}`);
  }

  ffmpegArgs.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    selectedHeight >= 1440 ? "27" : selectedHeight >= 1080 ? "26" : "24",
    "-c:a",
    "aac",
    "-movflags",
    "+frag_keyframe+empty_moov+faststart",
    "-f",
    "mp4",
    "pipe:1",
  );

  res.setHeader("cache-control", "no-store");
  res.type("video/mp4");

  const child = spawn(String(ffmpegPath), ffmpegArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  req.on("close", () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });

  child.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to start transcoder." });
    }
  });

  child.on("close", (code) => {
    if (code !== 0 && !res.writableEnded) {
      res.end();
      logEvent("warn", "session.video.transcode.failed", {
        sessionId: session.id,
        path: normalizedPath,
        quality: selectedQuality,
        code,
        stderr: stderr.slice(-500),
      });
    }
  });

  return child.stdout.pipe(res);
});

app.get("/api/sessions/:id/file", async (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    logEvent("warn", "session.file.missing", { sessionId: req.params.id });
    return res
      .status(404)
      .json({ error: "Session not found or already cleaned up." });
  }

  const requestedPath = String(req.query.path || "");
  if (!requestedPath || requestedPath === ".") {
    logEvent("warn", "session.file.rejected", {
      sessionId: session.id,
      reason: "missing_path",
    });
    return res.status(400).json({ error: "File path is required." });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    logEvent("warn", "session.file.rejected", {
      sessionId: session.id,
      requestedPath,
      reason: error.message,
    });
    return res.status(400).json({ error: error.message });
  }

  const targetPath = path.resolve(
    path.join(session.extractDir, normalizedPath),
  );
  const rootPath = path.resolve(session.extractDir);

  if (
    !targetPath.startsWith(`${rootPath}${path.sep}`) &&
    targetPath !== rootPath
  ) {
    logEvent("warn", "session.file.rejected", {
      sessionId: session.id,
      requestedPath,
      reason: "invalid_path",
    });
    return res.status(400).json({ error: "Invalid file path." });
  }

  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats || !fileStats.isFile()) {
    logEvent("warn", "session.file.missing", {
      sessionId: session.id,
      requestedPath: normalizedPath,
    });
    return res.status(404).json({ error: "File not found." });
  }

  const wantsPreview = req.query.preview === "1";
  const wantsThumbnail = req.query.thumbnail === "1";
  const wantsImagePreview = req.query.imagePreview === "1";
  const previewQuality = String(req.query.quality || "balanced");
  const contentType = mime.lookup(targetPath) || "application/octet-stream";
  const rangeHeader = req.headers.range;
  logEvent("info", "session.file.read", {
    sessionId: session.id,
    path: normalizedPath,
    preview: wantsPreview,
    thumbnail: wantsThumbnail,
    imagePreview: wantsImagePreview,
    previewQuality,
    size: fileStats.size,
    sizeLabel: formatBytes(fileStats.size),
    contentType,
  });
  res.setHeader("cache-control", "no-store");

  if (wantsPreview) {
    res.type(contentType);
    const previewBuffer = await readPreviewChunk(targetPath);
    return res.send(previewBuffer);
  }

  if (wantsThumbnail) {
    if (classifyMimeType(contentType) !== "image") {
      return res.status(400).json({
        error: "Thumbnail preview is only available for image files.",
      });
    }

    try {
      const thumbnailPath = await ensureThumbnail(
        session,
        normalizedPath,
        targetPath,
        req.query.size,
      );
      res.type("image/jpeg");
      return createReadStream(thumbnailPath).pipe(res);
    } catch (error) {
      logEvent("warn", "session.thumbnail.failed", {
        sessionId: session.id,
        path: normalizedPath,
        error: error.message,
      });
      res.type(contentType);
      return createReadStream(targetPath).pipe(res);
    }
  }

  if (wantsImagePreview) {
    if (classifyMimeType(contentType) !== "image") {
      return res
        .status(400)
        .json({ error: "Image preview is only available for image files." });
    }

    if (shouldPreserveOriginalPreview(contentType)) {
      res.type(contentType);
      return createReadStream(targetPath).pipe(res);
    }

    try {
      const previewPath = await ensureImagePreview(
        session,
        normalizedPath,
        targetPath,
        previewQuality,
      );
      res.type("image/jpeg");
      return createReadStream(previewPath).pipe(res);
    } catch (error) {
      logEvent("warn", "session.image_preview.failed", {
        sessionId: session.id,
        path: normalizedPath,
        quality: previewQuality,
        error: error.message,
      });
      res.type(contentType);
      return createReadStream(targetPath).pipe(res);
    }
  }

  res.setHeader("accept-ranges", "bytes");
  res.type(contentType);

  const range = parseRangeHeader(rangeHeader, fileStats.size);
  if (range === "invalid") {
    res.setHeader("content-range", `bytes */${fileStats.size}`);
    return res.status(416).end();
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    res.status(206);
    res.setHeader(
      "content-range",
      `bytes ${range.start}-${range.end}/${fileStats.size}`,
    );
    res.setHeader("content-length", String(contentLength));
    return createReadStream(targetPath, {
      start: range.start,
      end: range.end,
    }).pipe(res);
  }

  res.setHeader("content-length", String(fileStats.size));

  return createReadStream(targetPath).pipe(res);
});

app.delete("/api/sessions/:id", async (req, res) => {
  if (!sessionStore.has(req.params.id)) {
    logEvent("warn", "session.delete.missing", { sessionId: req.params.id });
    return res.status(404).json({ error: "Session not found." });
  }

  await removeSession(req.params.id, "manual");
  return res.status(204).end();
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

server = createServer(app);
attachJobWebSocketServer(server, { jobStore, sanitizeJob });

server.listen(PORT, "0.0.0.0", () => {
  logEvent("info", "server.started", {
    url: `http://0.0.0.0:${PORT}`,
    sessionTtlMs: SESSION_TTL_MS,
    cleanupIntervalMs: CLEANUP_INTERVAL_MS,
  });
});
