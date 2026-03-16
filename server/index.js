import express from 'express';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import crypto from 'node:crypto';
import mime from 'mime-types';
import sharp from 'sharp';
import unzipper from 'unzipper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');
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
const DOWNLOAD_PROGRESS_STEP_PERCENT = 10;
const DOWNLOAD_PROGRESS_STEP_BYTES = 25 * 1024 * 1024;
const EXTRACTION_PROGRESS_STEP_PERCENT = 10;
const MAX_THUMBNAIL_SIZE = 320;
const IMAGE_PREVIEW_PROFILES = {
  low: { size: 1280, quality: 58 },
  balanced: { size: 1920, quality: 72 },
  high: { size: 2560, quality: 82 }
};

app.use(express.json({ limit: '1mb' }));
app.use(express.static(distDir));

function logEvent(level, event, details = {}) {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  const payload = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  logger(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${event}${payload}`);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function classifyMimeType(contentType) {
  if (String(contentType).startsWith('image/')) {
    return 'image';
  }
  if (String(contentType).startsWith('text/') || contentType === 'application/json') {
    return 'text';
  }
  return 'binary';
}

function shouldPreserveOriginalPreview(contentType) {
  return contentType === 'image/svg+xml' || contentType === 'image/gif';
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null;
  }

  const [rawStart, rawEnd] = rangeHeader.replace('bytes=', '').split('-');
  if (rawStart.includes(',') || rawEnd?.includes(',')) {
    return null;
  }

  let start;
  let end;

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return 'invalid';
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return 'invalid';
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

function createJob(url) {
  const job = {
    id: crypto.randomUUID(),
    url,
    status: 'queued',
    phase: 'queued',
    downloadedBytes: 0,
    reportedSize: 0,
    percent: 0,
    extractedEntries: 0,
    totalEntries: 0,
    message: 'Waiting to start',
    error: '',
    requiresConfirmation: false,
    confirmTokenAccepted: false,
    sessionId: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    subscribers: new Set(),
    workspaceDir: '',
    zipPath: '',
    extractDir: '',
    abortController: null,
    cleanupAt: 0
  };

  jobStore.set(job.id, job);
  return job;
}

function sanitizeJob(job) {
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
    message: job.message,
    error: job.error,
    requiresConfirmation: job.requiresConfirmation,
    sessionId: job.sessionId
  };
}

function closeJob(job, terminalStatus) {
  job.status = terminalStatus;
  job.updatedAt = Date.now();
  job.cleanupAt = Date.now() + JOB_TTL_MS;
}

function emitJob(job, patch = {}, eventName = 'progress') {
  Object.assign(job, patch, { updatedAt: Date.now() });
  const payload = JSON.stringify(sanitizeJob(job));
  for (const res of job.subscribers) {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${payload}\n\n`);
    if (isTerminalJobStatus(job.status)) {
      res.end();
    }
  }

  if (isTerminalJobStatus(job.status)) {
    job.subscribers.clear();
  }
}

function isTerminalJobStatus(status) {
  return status === 'ready' || status === 'error' || status === 'cancelled';
}

async function cleanupJob(jobId, reason = 'cleanup') {
  const job = jobStore.get(jobId);
  if (!job) {
    return;
  }

  if (job.workspaceDir && !job.sessionId) {
    await rm(job.workspaceDir, { recursive: true, force: true }).catch(() => {});
  }

  for (const res of job.subscribers) {
    res.end();
  }

  job.subscribers.clear();
  jobStore.delete(jobId);
  logEvent('info', 'job.removed', { jobId, reason });
}

app.use((req, res, next) => {
  const isTrackedRequest = req.path === '/health' || req.path.startsWith('/api');
  if (!isTrackedRequest) {
    return next();
  }

  const startedAt = Date.now();
  logEvent('info', 'request.start', {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip
  });

  res.on('finish', () => {
    logEvent('info', 'request.finish', {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
});

function sanitizeEntryPath(entryPath) {
  const normalized = path.posix.normalize(String(entryPath || '').replace(/\\/g, '/'));
  const cleaned = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned || cleaned === '.' || cleaned.startsWith('../') || cleaned.includes('/../')) {
    throw new Error(`Unsafe entry path: ${entryPath}`);
  }
  return cleaned;
}

function createNode(name, nodePath, type) {
  return {
    name,
    path: nodePath,
    type,
    extension: type === 'file' ? path.extname(name).slice(1).toLowerCase() : '',
    modifiedAt: 0,
    children: type === 'directory' ? [] : undefined
  };
}

function buildTree(entries, rootName) {
  const root = {
    name: rootName,
    path: '.',
    type: 'directory',
    parentPath: '',
    modifiedAt: 0,
    children: []
  };
  const nodes = new Map([['.', root]]);
  let firstFilePath = '';
  let fileCount = 0;

  for (const entry of entries) {
    const parts = entry.relativePath.split('/').filter(Boolean);
    let currentPath = '.';

    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index];
      const nextPath = currentPath === '.' ? name : `${currentPath}/${name}`;
      const isLeaf = index === parts.length - 1;
      const type = isLeaf && entry.type === 'file' ? 'file' : 'directory';

      if (!nodes.has(nextPath)) {
        const node = createNode(name, nextPath, type);
        node.parentPath = currentPath;
        node.modifiedAt = entry.modifiedAt || 0;
        if (type === 'file') {
          node.size = entry.size;
        }
        nodes.set(nextPath, node);
        nodes.get(currentPath).children.push(node);
      } else if (entry.modifiedAt && nodes.get(nextPath).modifiedAt < entry.modifiedAt) {
        nodes.get(nextPath).modifiedAt = entry.modifiedAt;
      }

      currentPath = nextPath;
    }

    if (entry.type === 'file') {
      fileCount += 1;
      if (!firstFilePath) {
        firstFilePath = entry.relativePath;
      }
    }
  }

  return { tree: root, firstFilePath, stats: { fileCount } };
}

async function removeSession(sessionId, reason = 'manual') {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return;
  }

  sessionStore.delete(sessionId);
  await rm(session.workspaceDir, { recursive: true, force: true });
  logEvent('info', 'session.removed', {
    sessionId,
    reason,
    workspaceDir: session.workspaceDir
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
  const fileHandle = await open(targetPath, 'r');
  try {
    const buffer = Buffer.alloc(TEXT_PREVIEW_LIMIT);
    const { bytesRead } = await fileHandle.read(buffer, 0, TEXT_PREVIEW_LIMIT, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

async function ensureThumbnail(session, normalizedPath, targetPath, size) {
  const safeSize = Math.max(48, Math.min(Number(size) || 220, MAX_THUMBNAIL_SIZE));
  const hash = crypto.createHash('sha1').update(`${normalizedPath}:${safeSize}`).digest('hex');
  const thumbnailDir = path.join(session.workspaceDir, 'thumbnails');
  const thumbnailPath = path.join(thumbnailDir, `${hash}.jpg`);

  await mkdir(thumbnailDir, { recursive: true });

  const existing = await stat(thumbnailPath).catch(() => null);
  if (!existing) {
    await sharp(targetPath)
      .rotate()
      .resize({ width: safeSize, height: safeSize, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 55, mozjpeg: true })
      .toFile(thumbnailPath);

    logEvent('info', 'session.thumbnail.generated', {
      sessionId: session.id,
      path: normalizedPath,
      size: safeSize,
      thumbnailPath
    });
  }

  return thumbnailPath;
}

async function ensureImagePreview(session, normalizedPath, targetPath, profileName) {
  const profile = IMAGE_PREVIEW_PROFILES[profileName] || IMAGE_PREVIEW_PROFILES.balanced;
  const hash = crypto.createHash('sha1').update(`${normalizedPath}:${profileName}:${profile.size}:${profile.quality}`).digest('hex');
  const previewDir = path.join(session.workspaceDir, 'previews');
  const previewPath = path.join(previewDir, `${hash}.jpg`);

  await mkdir(previewDir, { recursive: true });

  const existing = await stat(previewPath).catch(() => null);
  if (!existing) {
    await sharp(targetPath)
      .rotate()
      .resize({ width: profile.size, height: profile.size, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#f7f3eb' })
      .jpeg({ quality: profile.quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
      .toFile(previewPath);

    logEvent('info', 'session.image_preview.generated', {
      sessionId: session.id,
      path: normalizedPath,
      profile: profileName,
      previewPath
    });
  }

  return previewPath;
}

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      removeSession(sessionId, 'expired').catch((error) => {
        logEvent('error', 'session.cleanup.failed', {
          sessionId,
          error: error.message,
          stack: error.stack
        });
      });
    }
  }

  for (const [jobId, job] of jobStore.entries()) {
    if (job.cleanupAt && now > job.cleanupAt) {
      cleanupJob(jobId, 'expired').catch((error) => {
        logEvent('error', 'job.cleanup.failed', {
          jobId,
          error: error.message,
          stack: error.stack
        });
      });
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

async function shutdown() {
  if (isShuttingDown) {
    logEvent('warn', 'shutdown.duplicate_signal_ignored');
    return;
  }

  isShuttingDown = true;
  logEvent('info', 'shutdown.start', { activeSessions: sessionStore.size });
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
    logEvent('info', 'server.stopped_accepting_requests');
  }

  await Promise.all([...sessionStore.keys()].map((sessionId) => removeSession(sessionId, 'shutdown')));
  await Promise.all([...jobStore.keys()].map((jobId) => cleanupJob(jobId, 'shutdown')));
  logEvent('info', 'shutdown.complete', { activeSessions: sessionStore.size });
  process.exit(0);
}

process.on('SIGTERM', () => {
  logEvent('info', 'signal.received', { signal: 'SIGTERM' });
  shutdown().catch((error) => {
    logEvent('error', 'shutdown.failed', {
      signal: 'SIGTERM',
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  logEvent('info', 'signal.received', { signal: 'SIGINT' });
  shutdown().catch((error) => {
    logEvent('error', 'shutdown.failed', {
      signal: 'SIGINT',
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessionStore.size, jobs: jobStore.size });
});

async function processSessionJob(job, confirmOversize = false) {
  const { url } = job;

  if (!url) {
    throw new Error('ZIP URL is required.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Enter a valid public URL.');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }

  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'zip-image-viewer-'));
  const zipPath = path.join(workspaceDir, 'archive.zip');
  const extractDir = path.join(workspaceDir, 'extracted');
  await mkdir(extractDir, { recursive: true });
  job.workspaceDir = workspaceDir;
  job.zipPath = zipPath;
  job.extractDir = extractDir;
  job.abortController = new AbortController();

  try {
    emitJob(job, { status: 'downloading', phase: 'downloading', message: 'Starting archive download', error: '' });
    logEvent('info', 'session.create.start', {
      jobId: job.id,
      url,
      confirmOversize,
      workspaceDir
    });

    const response = await fetch(url, { redirect: 'follow', signal: job.abortController.signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with status ${response.status}.`);
    }

    const headerSize = Number(response.headers.get('content-length')) || 0;
    emitJob(job, {
      reportedSize: headerSize,
      downloadedBytes: 0,
      percent: headerSize > 0 ? 0 : null,
      message: headerSize > 0 ? `Downloading archive: 0 of ${formatBytes(headerSize)}` : 'Downloading archive'
    });
    logEvent('info', 'download.start', {
      jobId: job.id,
      url,
      reportedSize: headerSize,
      reportedSizeLabel: formatBytes(headerSize)
    });

    if (headerSize > CONFIRM_SIZE_BYTES && !confirmOversize) {
      await rm(workspaceDir, { recursive: true, force: true });
      emitJob(job, {
        status: 'awaiting_confirmation',
        phase: 'confirm',
        requiresConfirmation: true,
        reportedSize: headerSize,
        message: `Archive is ${formatBytes(headerSize)} and needs confirmation before download.`
      }, 'confirmation');
      logEvent('warn', 'download.confirmation.required', {
        jobId: job.id,
        url,
        reportedSize: headerSize,
        reportedSizeLabel: formatBytes(headerSize),
        limit: CONFIRM_SIZE_BYTES,
        limitLabel: formatBytes(CONFIRM_SIZE_BYTES)
      });
      closeJob(job, 'awaiting_confirmation');
      return;
    }

    let downloadedBytes = 0;
    let nextProgressPercent = DOWNLOAD_PROGRESS_STEP_PERCENT;
    let nextProgressBytes = DOWNLOAD_PROGRESS_STEP_BYTES;
    const guard = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;

        if (headerSize > 0) {
          const percent = Math.floor((downloadedBytes / headerSize) * 100);
          if (percent >= nextProgressPercent) {
            emitJob(job, {
              downloadedBytes,
              reportedSize: headerSize,
              percent: Math.min(percent, 100),
              message: `Downloading archive: ${formatBytes(downloadedBytes)} of ${formatBytes(headerSize)}`
            });
            logEvent('info', 'download.progress', {
              jobId: job.id,
              url,
              downloadedBytes,
              downloadedLabel: formatBytes(downloadedBytes),
              totalBytes: headerSize,
              totalLabel: formatBytes(headerSize),
              percent: Math.min(percent, 100)
            });
            nextProgressPercent += DOWNLOAD_PROGRESS_STEP_PERCENT;
          }
        } else if (downloadedBytes >= nextProgressBytes) {
          emitJob(job, {
            downloadedBytes,
            reportedSize: 0,
            percent: null,
            message: `Downloading archive: ${formatBytes(downloadedBytes)} received`
          });
          logEvent('info', 'download.progress', {
            jobId: job.id,
            url,
            downloadedBytes,
            downloadedLabel: formatBytes(downloadedBytes)
          });
          nextProgressBytes += DOWNLOAD_PROGRESS_STEP_BYTES;
        }

        if (!confirmOversize && downloadedBytes > CONFIRM_SIZE_BYTES) {
          const error = new Error('Archive exceeds 1 GB.');
          error.code = 'OVERSIZE_CONFIRM';
          callback(error);
          return;
        }
        callback(null, chunk);
      }
    });

    try {
      await pipeline(Readable.fromWeb(response.body), guard, createWriteStream(zipPath));
      emitJob(job, {
        downloadedBytes,
        reportedSize: headerSize,
        percent: 100,
        message: 'Archive download complete. Preparing extraction...'
      });
      logEvent('info', 'download.complete', {
        jobId: job.id,
        url,
        downloadedBytes,
        downloadedLabel: formatBytes(downloadedBytes),
        zipPath
      });
    } catch (error) {
      if (error.code === 'OVERSIZE_CONFIRM') {
        await rm(workspaceDir, { recursive: true, force: true });
        emitJob(job, {
          status: 'awaiting_confirmation',
          phase: 'confirm',
          requiresConfirmation: true,
          reportedSize: downloadedBytes,
          downloadedBytes,
          percent: null,
          message: `Archive exceeded ${formatBytes(CONFIRM_SIZE_BYTES)} and needs confirmation to continue.`
        }, 'confirmation');
        logEvent('warn', 'download.confirmation.required', {
          jobId: job.id,
          url,
          reportedSize: downloadedBytes,
          reportedSizeLabel: formatBytes(downloadedBytes),
          limit: CONFIRM_SIZE_BYTES,
          limitLabel: formatBytes(CONFIRM_SIZE_BYTES)
        });
        closeJob(job, 'awaiting_confirmation');
        return;
      }
      throw error;
    }

    const directory = await unzipper.Open.file(zipPath);
    const extractedEntries = [];
    const extractRootPath = path.resolve(extractDir);
    let nextExtractPercent = EXTRACTION_PROGRESS_STEP_PERCENT;
    emitJob(job, {
      status: 'extracting',
      phase: 'extracting',
      totalEntries: directory.files.length,
      extractedEntries: 0,
      percent: 0,
      message: `Extracting archive: 0 of ${directory.files.length} entries`
    });
    logEvent('info', 'extract.start', {
      jobId: job.id,
      url,
      entryCount: directory.files.length,
      extractDir
    });

    for (const entry of directory.files) {
      const relativePath = sanitizeEntryPath(entry.path);
      const destination = path.join(extractDir, relativePath);
      const resolved = path.resolve(destination);

      if (!resolved.startsWith(`${extractRootPath}${path.sep}`) && resolved !== extractRootPath) {
        throw new Error('Archive contains invalid file paths.');
      }

      if (entry.type === 'Directory') {
        await mkdir(destination, { recursive: true });
        extractedEntries.push({ relativePath, type: 'directory', size: 0, modifiedAt: entry.lastModifiedDateTime?.getTime() || 0 });
        const extractPercent = Math.floor((extractedEntries.length / directory.files.length) * 100);
        if (extractPercent >= nextExtractPercent) {
          emitJob(job, {
            extractedEntries: extractedEntries.length,
            totalEntries: directory.files.length,
            percent: Math.min(extractPercent, 100),
            message: `Extracting archive: ${extractedEntries.length} of ${directory.files.length} entries`
          });
          nextExtractPercent += EXTRACTION_PROGRESS_STEP_PERCENT;
        }
        continue;
      }

      await mkdir(path.dirname(destination), { recursive: true });
      await pipeline(entry.stream(), createWriteStream(destination));
      extractedEntries.push({
        relativePath,
        type: 'file',
        size: entry.uncompressedSize || 0,
        modifiedAt: entry.lastModifiedDateTime?.getTime() || 0
      });

      const extractPercent = Math.floor((extractedEntries.length / directory.files.length) * 100);
      if (extractPercent >= nextExtractPercent) {
        emitJob(job, {
          extractedEntries: extractedEntries.length,
          totalEntries: directory.files.length,
          percent: Math.min(extractPercent, 100),
          message: `Extracting archive: ${extractedEntries.length} of ${directory.files.length} entries`
        });
        nextExtractPercent += EXTRACTION_PROGRESS_STEP_PERCENT;
      }
    }

    const archiveName = path.basename(parsedUrl.pathname) || 'archive.zip';
    const rootName = archiveName.replace(/\.zip$/i, '') || archiveName;
    const { tree, firstFilePath, stats } = buildTree(extractedEntries, rootName);
    const sessionId = crypto.randomUUID();
    const directoryCount = extractedEntries.length - stats.fileCount;

    logEvent('info', 'extract.complete', {
      jobId: job.id,
      url,
      entryCount: extractedEntries.length,
      fileCount: stats.fileCount,
      directoryCount,
      firstFilePath
    });

    sessionStore.set(sessionId, {
      id: sessionId,
      workspaceDir,
      extractDir,
      tree,
      firstFilePath,
      stats,
      lastAccessedAt: Date.now()
    });

    logEvent('info', 'session.create.complete', {
      jobId: job.id,
      sessionId,
      url,
      fileCount: stats.fileCount,
      firstFilePath
    });

    job.workspaceDir = '';
    job.extractDir = '';
    job.zipPath = '';

    emitJob(job, {
      status: 'ready',
      phase: 'ready',
      sessionId,
      percent: 100,
      message: 'Archive is ready to browse.',
      requiresConfirmation: false
    }, 'ready');
    closeJob(job, 'ready');
  } catch (error) {
    await rm(workspaceDir, { recursive: true, force: true });
    logEvent('error', 'session.create.failed', {
      jobId: job.id,
      url,
      error: error.message,
      stack: error.stack
    });

    if (error.name === 'AbortError') {
      emitJob(job, {
        status: 'cancelled',
        phase: 'cancelled',
        error: '',
        message: 'Archive loading was cancelled.'
      }, 'cancelled');
      closeJob(job, 'cancelled');
      return;
    }

    emitJob(job, {
      status: 'error',
      phase: 'error',
      error: error.message || 'Could not process this ZIP file.',
      message: error.message || 'Could not process this ZIP file.'
    }, 'job-error');
    closeJob(job, 'error');
  }
}

app.post('/api/sessions', async (req, res) => {
  const { url, confirmOversize = false } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'ZIP URL is required.' });
  }
  const job = createJob(url);

  emitJob(job, { message: 'Queued archive request' });
  processSessionJob(job, confirmOversize).catch((error) => {
    logEvent('error', 'job.process.unhandled', {
      jobId: job.id,
      error: error.message,
      stack: error.stack
    });
  });

  return res.status(202).json({ jobId: job.id, ...sanitizeJob(job) });
});

app.get('/api/session-jobs/:id', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  return res.json(sanitizeJob(job));
});

app.get('/api/session-jobs/:id/events', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();

  job.subscribers.add(res);
  res.write('retry: 1500\n\n');
  res.write(`event: progress\n`);
  res.write(`data: ${JSON.stringify(sanitizeJob(job))}\n\n`);

  req.on('close', () => {
    job.subscribers.delete(res);
  });
});

app.post('/api/session-jobs/:id/confirm', (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  if (!job.requiresConfirmation) {
    return res.status(400).json({ error: 'This job does not need confirmation.' });
  }

  job.requiresConfirmation = false;
  job.cleanupAt = 0;
  processSessionJob(job, true).catch((error) => {
    logEvent('error', 'job.confirm.unhandled', {
      jobId: job.id,
      error: error.message,
      stack: error.stack
    });
  });

  return res.json(sanitizeJob(job));
});

app.delete('/api/session-jobs/:id', async (req, res) => {
  const job = jobStore.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  job.abortController?.abort();
  emitJob(job, {
    status: 'cancelled',
    phase: 'cancelled',
    error: '',
    message: 'Archive loading was cancelled.'
  }, 'cancelled');
  closeJob(job, 'cancelled');
  await cleanupJob(job.id, 'cancelled');
  return res.status(204).end();
});

app.get('/api/sessions/:id/tree', (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    logEvent('warn', 'session.tree.missing', { sessionId: req.params.id });
    return res.status(404).json({ error: 'Session not found or already cleaned up.' });
  }

  logEvent('info', 'session.tree.read', {
    sessionId: session.id,
    fileCount: session.stats.fileCount
  });

  return res.json({
    id: session.id,
    tree: session.tree,
    firstFilePath: session.firstFilePath,
    stats: session.stats
  });
});

app.get('/api/sessions/:id/file', async (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    logEvent('warn', 'session.file.missing', { sessionId: req.params.id });
    return res.status(404).json({ error: 'Session not found or already cleaned up.' });
  }

  const requestedPath = String(req.query.path || '');
  if (!requestedPath || requestedPath === '.') {
    logEvent('warn', 'session.file.rejected', {
      sessionId: session.id,
      reason: 'missing_path'
    });
    return res.status(400).json({ error: 'File path is required.' });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    logEvent('warn', 'session.file.rejected', {
      sessionId: session.id,
      requestedPath,
      reason: error.message
    });
    return res.status(400).json({ error: error.message });
  }

  const targetPath = path.resolve(path.join(session.extractDir, normalizedPath));
  const rootPath = path.resolve(session.extractDir);

  if (!targetPath.startsWith(`${rootPath}${path.sep}`) && targetPath !== rootPath) {
    logEvent('warn', 'session.file.rejected', {
      sessionId: session.id,
      requestedPath,
      reason: 'invalid_path'
    });
    return res.status(400).json({ error: 'Invalid file path.' });
  }

  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats || !fileStats.isFile()) {
    logEvent('warn', 'session.file.missing', {
      sessionId: session.id,
      requestedPath: normalizedPath
    });
    return res.status(404).json({ error: 'File not found.' });
  }

  const wantsPreview = req.query.preview === '1';
  const wantsThumbnail = req.query.thumbnail === '1';
  const wantsImagePreview = req.query.imagePreview === '1';
  const previewQuality = String(req.query.quality || 'balanced');
  const contentType = mime.lookup(targetPath) || 'application/octet-stream';
  const rangeHeader = req.headers.range;
  logEvent('info', 'session.file.read', {
    sessionId: session.id,
    path: normalizedPath,
    preview: wantsPreview,
    thumbnail: wantsThumbnail,
    imagePreview: wantsImagePreview,
    previewQuality,
    size: fileStats.size,
    sizeLabel: formatBytes(fileStats.size),
    contentType
  });
  res.setHeader('cache-control', 'no-store');

  if (wantsPreview) {
    res.type(contentType);
    const previewBuffer = await readPreviewChunk(targetPath);
    return res.send(previewBuffer);
  }

  if (wantsThumbnail) {
    if (classifyMimeType(contentType) !== 'image') {
      return res.status(400).json({ error: 'Thumbnail preview is only available for image files.' });
    }

    try {
      const thumbnailPath = await ensureThumbnail(session, normalizedPath, targetPath, req.query.size);
      res.type('image/jpeg');
      return createReadStream(thumbnailPath).pipe(res);
    } catch (error) {
      logEvent('warn', 'session.thumbnail.failed', {
        sessionId: session.id,
        path: normalizedPath,
        error: error.message
      });
      res.type(contentType);
      return createReadStream(targetPath).pipe(res);
    }
  }

  if (wantsImagePreview) {
    if (classifyMimeType(contentType) !== 'image') {
      return res.status(400).json({ error: 'Image preview is only available for image files.' });
    }

    if (shouldPreserveOriginalPreview(contentType)) {
      res.type(contentType);
      return createReadStream(targetPath).pipe(res);
    }

    try {
      const previewPath = await ensureImagePreview(session, normalizedPath, targetPath, previewQuality);
      res.type('image/jpeg');
      return createReadStream(previewPath).pipe(res);
    } catch (error) {
      logEvent('warn', 'session.image_preview.failed', {
        sessionId: session.id,
        path: normalizedPath,
        quality: previewQuality,
        error: error.message
      });
      res.type(contentType);
      return createReadStream(targetPath).pipe(res);
    }
  }

  res.setHeader('accept-ranges', 'bytes');
  res.type(contentType);

  const range = parseRangeHeader(rangeHeader, fileStats.size);
  if (range === 'invalid') {
    res.setHeader('content-range', `bytes */${fileStats.size}`);
    return res.status(416).end();
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    res.status(206);
    res.setHeader('content-range', `bytes ${range.start}-${range.end}/${fileStats.size}`);
    res.setHeader('content-length', String(contentLength));
    return createReadStream(targetPath, { start: range.start, end: range.end }).pipe(res);
  }

  res.setHeader('content-length', String(fileStats.size));

  return createReadStream(targetPath).pipe(res);
});

app.delete('/api/sessions/:id', async (req, res) => {
  if (!sessionStore.has(req.params.id)) {
    logEvent('warn', 'session.delete.missing', { sessionId: req.params.id });
    return res.status(404).json({ error: 'Session not found.' });
  }

  await removeSession(req.params.id, 'manual');
  return res.status(204).end();
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

server = app.listen(PORT, '0.0.0.0', () => {
  logEvent('info', 'server.started', {
    url: `http://0.0.0.0:${PORT}`,
    sessionTtlMs: SESSION_TTL_MS,
    cleanupIntervalMs: CLEANUP_INTERVAL_MS
  });
});
