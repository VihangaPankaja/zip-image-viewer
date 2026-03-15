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
let server;
let isShuttingDown = false;

const PORT = Number(process.env.PORT || 8080);
const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const CONFIRM_SIZE_BYTES = 1024 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
const DOWNLOAD_PROGRESS_STEP_PERCENT = 10;
const DOWNLOAD_PROGRESS_STEP_BYTES = 25 * 1024 * 1024;
const MAX_THUMBNAIL_SIZE = 320;

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
    children: type === 'directory' ? [] : undefined
  };
}

function sortTree(node) {
  if (node.type !== 'directory') {
    return node;
  }

  node.children.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  node.children.forEach(sortTree);
  return node;
}

function buildTree(entries, rootName) {
  const root = {
    name: rootName,
    path: '.',
    type: 'directory',
    parentPath: '',
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
        if (type === 'file') {
          node.size = entry.size;
        }
        nodes.set(nextPath, node);
        nodes.get(currentPath).children.push(node);
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

  return { tree: sortTree(root), firstFilePath, stats: { fileCount } };
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
  res.json({ ok: true, sessions: sessionStore.size });
});

app.post('/api/sessions', async (req, res) => {
  const { url, confirmOversize = false } = req.body || {};

  if (!url) {
    logEvent('warn', 'session.create.rejected', { reason: 'missing_url' });
    return res.status(400).json({ error: 'ZIP URL is required.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    logEvent('warn', 'session.create.rejected', { url, reason: 'invalid_url' });
    return res.status(400).json({ error: 'Enter a valid public URL.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    logEvent('warn', 'session.create.rejected', { url, reason: 'unsupported_protocol' });
    return res.status(400).json({ error: 'Only HTTP and HTTPS URLs are supported.' });
  }

  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'zip-image-viewer-'));
  const zipPath = path.join(workspaceDir, 'archive.zip');
  const extractDir = path.join(workspaceDir, 'extracted');
  await mkdir(extractDir, { recursive: true });

  try {
    logEvent('info', 'session.create.start', {
      url,
      confirmOversize,
      workspaceDir
    });

    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with status ${response.status}.`);
    }

    const headerSize = Number(response.headers.get('content-length')) || 0;
    logEvent('info', 'download.start', {
      url,
      reportedSize: headerSize,
      reportedSizeLabel: formatBytes(headerSize)
    });

    if (headerSize > CONFIRM_SIZE_BYTES && !confirmOversize) {
      await rm(workspaceDir, { recursive: true, force: true });
      logEvent('warn', 'download.confirmation.required', {
        url,
        reportedSize: headerSize,
        reportedSizeLabel: formatBytes(headerSize),
        limit: CONFIRM_SIZE_BYTES,
        limitLabel: formatBytes(CONFIRM_SIZE_BYTES)
      });
      return res.json({
        requiresConfirmation: true,
        reportedSize: headerSize,
        limit: CONFIRM_SIZE_BYTES
      });
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
            logEvent('info', 'download.progress', {
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
          logEvent('info', 'download.progress', {
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
      logEvent('info', 'download.complete', {
        url,
        downloadedBytes,
        downloadedLabel: formatBytes(downloadedBytes),
        zipPath
      });
    } catch (error) {
      if (error.code === 'OVERSIZE_CONFIRM') {
        await rm(workspaceDir, { recursive: true, force: true });
        logEvent('warn', 'download.confirmation.required', {
          url,
          reportedSize: downloadedBytes,
          reportedSizeLabel: formatBytes(downloadedBytes),
          limit: CONFIRM_SIZE_BYTES,
          limitLabel: formatBytes(CONFIRM_SIZE_BYTES)
        });
        return res.json({
          requiresConfirmation: true,
          reportedSize: downloadedBytes,
          limit: CONFIRM_SIZE_BYTES
        });
      }
      throw error;
    }

    const directory = await unzipper.Open.file(zipPath);
    const extractedEntries = [];
    const extractRootPath = path.resolve(extractDir);
    logEvent('info', 'extract.start', {
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
        extractedEntries.push({ relativePath, type: 'directory', size: 0 });
        continue;
      }

      await mkdir(path.dirname(destination), { recursive: true });
      await pipeline(entry.stream(), createWriteStream(destination));
      extractedEntries.push({ relativePath, type: 'file', size: entry.uncompressedSize || 0 });
    }

    const archiveName = path.basename(parsedUrl.pathname) || 'archive.zip';
    const rootName = archiveName.replace(/\.zip$/i, '') || archiveName;
    const { tree, firstFilePath, stats } = buildTree(extractedEntries, rootName);
    const sessionId = crypto.randomUUID();
    const directoryCount = extractedEntries.length - stats.fileCount;

    logEvent('info', 'extract.complete', {
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
      sessionId,
      url,
      fileCount: stats.fileCount,
      firstFilePath
    });

    return res.json({
      id: sessionId,
      tree,
      firstFilePath,
      stats
    });
  } catch (error) {
    await rm(workspaceDir, { recursive: true, force: true });
    logEvent('error', 'session.create.failed', {
      url,
      error: error.message,
      stack: error.stack
    });
    return res.status(400).json({ error: error.message || 'Could not process this ZIP file.' });
  }
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
  const contentType = mime.lookup(targetPath) || 'application/octet-stream';
  logEvent('info', 'session.file.read', {
    sessionId: session.id,
    path: normalizedPath,
    preview: wantsPreview,
    thumbnail: wantsThumbnail,
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

  res.type(contentType);

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
