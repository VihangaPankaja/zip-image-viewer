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
import unzipper from 'unzipper';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');
const app = express();
const sessionStore = new Map();

const PORT = Number(process.env.PORT || 8080);
const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const CONFIRM_SIZE_BYTES = 1024 * 1024 * 1024;
const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(distDir));

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

async function removeSession(sessionId) {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return;
  }

  sessionStore.delete(sessionId);
  await rm(session.workspaceDir, { recursive: true, force: true });
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

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      removeSession(sessionId).catch((error) => console.error('cleanup failed', error));
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

async function shutdown() {
  await Promise.all([...sessionStore.keys()].map((sessionId) => removeSession(sessionId)));
  process.exit(0);
}

process.on('SIGTERM', () => {
  shutdown().catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

process.on('SIGINT', () => {
  shutdown().catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessionStore.size });
});

app.post('/api/sessions', async (req, res) => {
  const { url, confirmOversize = false } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: 'ZIP URL is required.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Enter a valid public URL.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only HTTP and HTTPS URLs are supported.' });
  }

  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'zip-image-viewer-'));
  const zipPath = path.join(workspaceDir, 'archive.zip');
  const extractDir = path.join(workspaceDir, 'extracted');
  await mkdir(extractDir, { recursive: true });

  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with status ${response.status}.`);
    }

    const headerSize = Number(response.headers.get('content-length')) || 0;
    if (headerSize > CONFIRM_SIZE_BYTES && !confirmOversize) {
      await rm(workspaceDir, { recursive: true, force: true });
      return res.json({
        requiresConfirmation: true,
        reportedSize: headerSize,
        limit: CONFIRM_SIZE_BYTES
      });
    }

    let downloadedBytes = 0;
    const guard = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
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
    } catch (error) {
      if (error.code === 'OVERSIZE_CONFIRM') {
        await rm(workspaceDir, { recursive: true, force: true });
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

    sessionStore.set(sessionId, {
      id: sessionId,
      workspaceDir,
      extractDir,
      tree,
      firstFilePath,
      stats,
      lastAccessedAt: Date.now()
    });

    return res.json({
      id: sessionId,
      tree,
      firstFilePath,
      stats
    });
  } catch (error) {
    await rm(workspaceDir, { recursive: true, force: true });
    console.error(error);
    return res.status(400).json({ error: error.message || 'Could not process this ZIP file.' });
  }
});

app.get('/api/sessions/:id/tree', (req, res) => {
  const session = touchSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or already cleaned up.' });
  }

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
    return res.status(404).json({ error: 'Session not found or already cleaned up.' });
  }

  const requestedPath = String(req.query.path || '');
  if (!requestedPath || requestedPath === '.') {
    return res.status(400).json({ error: 'File path is required.' });
  }

  let normalizedPath;
  try {
    normalizedPath = sanitizeEntryPath(requestedPath);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const targetPath = path.resolve(path.join(session.extractDir, normalizedPath));
  const rootPath = path.resolve(session.extractDir);

  if (!targetPath.startsWith(`${rootPath}${path.sep}`) && targetPath !== rootPath) {
    return res.status(400).json({ error: 'Invalid file path.' });
  }

  const fileStats = await stat(targetPath).catch(() => null);
  if (!fileStats || !fileStats.isFile()) {
    return res.status(404).json({ error: 'File not found.' });
  }

  const wantsPreview = req.query.preview === '1';
  const contentType = mime.lookup(targetPath) || 'application/octet-stream';
  res.setHeader('cache-control', 'no-store');
  res.type(contentType);

  if (wantsPreview) {
    const previewBuffer = await readPreviewChunk(targetPath);
    return res.send(previewBuffer);
  }

  return createReadStream(targetPath).pipe(res);
});

app.delete('/api/sessions/:id', async (req, res) => {
  if (!sessionStore.has(req.params.id)) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  await removeSession(req.params.id);
  return res.status(204).end();
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`zip-image-viewer listening on http://0.0.0.0:${PORT}`);
});
