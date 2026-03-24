import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'csv',
  'log',
  'xml',
  'yml',
  'yaml',
  'js',
  'jsx',
  'ts',
  'tsx',
  'html',
  'css'
]);

const FOLDER_THUMB_SIZE = 88;
const STRIP_THUMB_SIZE = 220;
const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
  { value: 'date-asc', label: 'Date oldest' },
  { value: 'date-desc', label: 'Date newest' },
  { value: 'natural-tail', label: 'Number trail' }
];
const PREVIEW_QUALITY_OPTIONS = [
  { value: 'low', label: 'Low preview' },
  { value: 'balanced', label: 'Balanced preview' },
  { value: 'high', label: 'High preview' }
];
const SLIDESHOW_FIT_OPTIONS = [
  { value: 'best-fit', label: 'Best fit' },
  { value: 'fit-width', label: 'Fit width' },
  { value: 'fit-height', label: 'Fit height' }
];
const NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: false });

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTransferBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '--';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '--';
  return `${formatTransferBytes(bytesPerSec)}/s`;
}

function formatDate(value) {
  if (!value) {
    return 'Date unknown';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(value);
}

function classifyNode(node) {
  if (!node || node.type === 'directory') return 'directory';
  if (IMAGE_EXTENSIONS.has(node.extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(node.extension)) return 'video';
  if (TEXT_EXTENSIONS.has(node.extension)) return 'text';
  return 'binary';
}

function getNodeBadge(node) {
  const kind = classifyNode(node);
  if (kind === 'image') return 'IMG';
  if (kind === 'video') return 'VID';
  return 'FILE';
}

function buildFileUrl(sessionId, filePath, options = {}) {
  if (!sessionId || !filePath) {
    return '';
  }

  const params = new URLSearchParams({ path: filePath });
  if (options.previewText) {
    params.set('preview', '1');
  }
  if (options.thumbnail) {
    params.set('thumbnail', '1');
    params.set('size', String(options.size || STRIP_THUMB_SIZE));
  }
  if (options.imagePreview) {
    params.set('imagePreview', '1');
    params.set('quality', options.quality || 'balanced');
  }

  return `/api/sessions/${sessionId}/file?${params.toString()}`;
}

function getNameBase(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

function parseTrailingNumber(name) {
  const baseName = getNameBase(name).trim();
  const match = baseName.match(/^(.*?)(?:[\s._-]*\(?([0-9]+)\)?)$/);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1].trim(),
    number: Number(match[2])
  };
}

function compareByName(left, right) {
  return NAME_COLLATOR.compare(left.name, right.name);
}

function compareByNaturalTail(left, right) {
  const leftTail = parseTrailingNumber(left.name);
  const rightTail = parseTrailingNumber(right.name);

  if (leftTail && rightTail) {
    const prefixCompare = NAME_COLLATOR.compare(leftTail.prefix, rightTail.prefix);
    if (prefixCompare !== 0) {
      return prefixCompare;
    }
    if (leftTail.number !== rightTail.number) {
      return leftTail.number - rightTail.number;
    }
  }

  return compareByName(left, right);
}

function compareByDate(left, right, direction) {
  const leftValue = left.modifiedAt || 0;
  const rightValue = right.modifiedAt || 0;
  if (leftValue !== rightValue) {
    return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
  }
  return compareByName(left, right);
}

function compareNodes(left, right, sortMode) {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1;
  }

  switch (sortMode) {
    case 'name-desc':
      return compareByName(right, left);
    case 'date-asc':
      return compareByDate(left, right, 'asc');
    case 'date-desc':
      return compareByDate(left, right, 'desc');
    case 'natural-tail':
      return compareByNaturalTail(left, right);
    case 'name-asc':
    default:
      return compareByName(left, right);
  }
}

function cloneAndSortTree(node, sortMode) {
  if (node.type !== 'directory') {
    return { ...node };
  }

  const children = node.children.map((child) => cloneAndSortTree(child, sortMode));
  children.sort((left, right) => compareNodes(left, right, sortMode));

  return {
    ...node,
    children
  };
}

function flattenTree(tree) {
  const nodesByPath = new Map();
  const folderImages = new Map();
  const folderPreview = new Map();

  function walk(node) {
    nodesByPath.set(node.path, node);
    if (node.type === 'directory') {
      const imageChildren = node.children.filter((child) => classifyNode(child) === 'image');
      folderImages.set(
        node.path,
        imageChildren.map((child) => child.path)
      );
      folderPreview.set(node.path, imageChildren[0]?.path || '');
      node.children.forEach(walk);
    }
  }

  walk(tree);
  return { nodesByPath, folderImages, folderPreview };
}

function getFirstFilePath(node) {
  if (!node) {
    return '';
  }

  if (node.type === 'file') {
    return node.path;
  }

  for (const child of node.children) {
    const match = getFirstFilePath(child);
    if (match) {
      return match;
    }
  }

  return node.path;
}

function getThumbnailWindow(items, currentPath, radius = 2) {
  if (items.length <= radius * 2 + 1) {
    return items;
  }

  const currentIndex = items.findIndex((item) => item.path === currentPath);
  if (currentIndex === -1) {
    return items.slice(0, radius * 2 + 1);
  }

  const visible = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = (currentIndex + offset + items.length) % items.length;
    visible.push(items[index]);
  }
  return visible;
}

function getImageCacheKey(sessionId, imagePath, quality) {
  return `${sessionId}:${imagePath}:${quality}`;
}

function getWrappedPath(items, currentIndex, delta) {
  if (!items.length || currentIndex === -1) {
    return '';
  }

  const nextIndex = (currentIndex + delta + items.length) % items.length;
  return items[nextIndex] || '';
}

function formatProgressMessage(job) {
  if (!job) {
    return '';
  }

  if (job.message) {
    return job.message;
  }

  if (job.phase === 'downloading' && job.reportedSize > 0) {
    return `Downloading archive: ${formatTransferBytes(job.downloadedBytes)} of ${formatTransferBytes(job.reportedSize)}`;
  }

  if (job.phase === 'downloading') {
    return `Downloading archive: ${formatTransferBytes(job.downloadedBytes)} received`;
  }

  if (job.phase === 'extracting') {
    return `Extracting archive: ${job.extractedEntries || 0} of ${job.totalEntries || 0} entries`;
  }

  return 'Working on archive...';
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTerminalJobStatus(status) {
  return status === 'ready' || status === 'error' || status === 'cancelled';
}

function TreeNode({ node, selectedPath, onSelect, sessionId, folderPreview, folderImages, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  const isDirectory = node.type === 'directory';
  const isSelected = node.path === selectedPath;
  const previewPath = sessionId ? folderPreview.get(node.path) : '';
  const previewCount = folderImages.get(node.path)?.length || 0;

  if (isDirectory) {
    return (
      <div className="tree-node">
        <button
          type="button"
          className={`tree-row tree-folder ${isSelected ? 'selected' : ''}`}
          style={{ '--depth': depth }}
          onClick={() => {
            setOpen((current) => !current);
            onSelect(node);
          }}
        >
          <span className="tree-caret">{open ? 'v' : '>'}</span>
          <span className="tree-icon folder-icon-shell">
            {previewPath ? (
              <img
                className="folder-thumb"
                src={buildFileUrl(sessionId, previewPath, { thumbnail: true, size: FOLDER_THUMB_SIZE })}
                alt=""
                loading="lazy"
              />
            ) : (
              '[]'
            )}
          </span>
          <span className="tree-label">{node.name}</span>
          <span className="tree-meta">{previewCount > 0 ? `${previewCount} img` : node.children.length}</span>
        </button>
        {open ? (
          <div>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                sessionId={sessionId}
                folderPreview={folderPreview}
                folderImages={folderImages}
                depth={depth + 1}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`tree-row tree-file ${isSelected ? 'selected' : ''}`}
      style={{ '--depth': depth }}
      onClick={() => onSelect(node)}
    >
      <span className="tree-caret" />
      <span className="tree-icon">{getNodeBadge(node)}</span>
      <span className="tree-label">{node.name}</span>
      <span className="tree-meta">{node.extension || '--'}</span>
    </button>
  );
}

function CustomDropdown({ id, label, value, options, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const activeOption = options.find((option) => option.value === value) || options[0] || null;

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function onEscape(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onEscape);
    };
  }, []);

  return (
    <div ref={rootRef} className={`toolbar-select-shell custom-dropdown-shell ${className}`.trim()}>
      <span className="toolbar-label">{label}</span>
      <button
        type="button"
        id={id}
        className={`custom-dropdown-trigger ${open ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{activeOption?.label || 'Select'}</span>
        <span className="custom-dropdown-caret">{open ? '^' : 'v'}</span>
      </button>

      {open ? (
        <div className="custom-dropdown-menu" role="listbox" aria-labelledby={id}>
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`custom-dropdown-option ${isActive ? 'active' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [zipUrl, setZipUrl] = useState('');
  const [session, setSession] = useState(null);
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') {
      return 'dark';
    }
    return window.localStorage.getItem('zip-image-viewer-theme') || 'dark';
  });
  const [selectedPath, setSelectedPath] = useState('');
  const [sortMode, setSortMode] = useState('natural-tail');
  const [previewQuality, setPreviewQuality] = useState('balanced');
  const [thumbnailStripExpanded, setThumbnailStripExpanded] = useState(false);
  const [textPreview, setTextPreview] = useState('');
  const [selectedImageSrc, setSelectedImageSrc] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [oversizePrompt, setOversizePrompt] = useState(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [slideshowFitMode, setSlideshowFitMode] = useState('best-fit');
  const [slideshowChromeHidden, setSlideshowChromeHidden] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [optimisticProgress, setOptimisticProgress] = useState(null);
  const textPreviewCacheRef = useRef(new Map());
  const imagePreviewCacheRef = useRef(new Map());
  const eventSourceRef = useRef(null);
  const jobPollTimeoutRef = useRef(null);
  const latestSessionIdRef = useRef('');
  const latestJobIdRef = useRef('');
  const hydrationRef = useRef({ sessionId: '', promise: null });
  const optimisticProgressRef = useRef({
    timer: null,
    baselineTime: 0,
    baselineBytes: 0,
    targetBytes: 0,
    reportedSize: 0,
    speed: 0,
    phase: ''
  });

  const sortedTree = useMemo(() => {
    if (!session?.tree) {
      return null;
    }
    return cloneAndSortTree(session.tree, sortMode);
  }, [session, sortMode]);

  const flatData = useMemo(() => (sortedTree ? flattenTree(sortedTree) : null), [sortedTree]);
  const selectedNode = flatData?.nodesByPath.get(selectedPath) || null;
  const selectedKind = classifyNode(selectedNode);
  const currentFolderImages = selectedNode ? flatData?.folderImages.get(selectedNode.parentPath) || [] : [];
  const currentImageIndex = selectedNode ? currentFolderImages.indexOf(selectedNode.path) : -1;
  const selectedFileUrl =
    session && selectedNode && selectedNode.type === 'file'
      ? buildFileUrl(session.id, selectedNode.path)
      : '';
  const selectedImagePreviewUrl =
    session && selectedNode && selectedNode.type === 'file' && selectedKind === 'image'
      ? buildFileUrl(session.id, selectedNode.path, { imagePreview: true, quality: previewQuality })
      : '';
  const selectedPreviewUrl =
    session && selectedNode && selectedNode.type === 'file'
      ? buildFileUrl(session.id, selectedNode.path, { previewText: true })
      : '';
  const currentFolderImageItems = currentFolderImages.map((imagePath) => ({
    path: imagePath,
    name: flatData?.nodesByPath.get(imagePath)?.name || imagePath.split('/').at(-1) || imagePath,
    url: buildFileUrl(session?.id, imagePath),
    previewUrl: buildFileUrl(session?.id, imagePath, { imagePreview: true, quality: previewQuality }),
    thumbnailUrl: buildFileUrl(session?.id, imagePath, { thumbnail: true, size: STRIP_THUMB_SIZE })
  }));
  const visibleThumbnailItems = thumbnailStripExpanded
    ? currentFolderImageItems
    : getThumbnailWindow(currentFolderImageItems, selectedPath, 2);
  const previousImagePath = getWrappedPath(currentFolderImages, currentImageIndex, -1);
  const nextImagePath = getWrappedPath(currentFolderImages, currentImageIndex, 1);
  const previousImageName = flatData?.nodesByPath.get(previousImagePath)?.name || '';
  const nextImageName = flatData?.nodesByPath.get(nextImagePath)?.name || '';

  function closeJobEvents() {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }

  function stopOptimisticProgress() {
    if (optimisticProgressRef.current.timer) {
      window.clearInterval(optimisticProgressRef.current.timer);
      optimisticProgressRef.current.timer = null;
    }
    optimisticProgressRef.current = {
      timer: null,
      baselineTime: 0,
      baselineBytes: 0,
      targetBytes: 0,
      reportedSize: 0,
      speed: 0,
      phase: ''
    };
    setOptimisticProgress(null);
  }

  function startOptimisticProgressFromJob(job) {
    if (!job || job.phase !== 'downloading') {
      stopOptimisticProgress();
      return;
    }

    const now = Date.now();
    const baselineBytes = Math.max(0, Number(job.downloadedBytes) || 0);
    const speed = Math.max(0, Number(job.downloadSpeedBytesPerSec) || 0);
    const targetBytes = baselineBytes + speed;

    optimisticProgressRef.current.baselineTime = now;
    optimisticProgressRef.current.baselineBytes = baselineBytes;
    optimisticProgressRef.current.targetBytes = targetBytes;
    optimisticProgressRef.current.reportedSize = Math.max(0, Number(job.reportedSize) || 0);
    optimisticProgressRef.current.speed = speed;
    optimisticProgressRef.current.phase = job.phase;
    setOptimisticProgress({ downloadedBytes: baselineBytes, percent: job.percent });

    if (optimisticProgressRef.current.timer) {
      return;
    }

    optimisticProgressRef.current.timer = window.setInterval(() => {
      const state = optimisticProgressRef.current;
      if (state.phase !== 'downloading') {
        return;
      }

      const elapsed = Math.min(1000, Math.max(0, Date.now() - state.baselineTime));
      const progress = elapsed / 1000;
      const estimatedBytes = state.baselineBytes + (state.targetBytes - state.baselineBytes) * progress;
      const downloadedBytes = Math.max(state.baselineBytes, estimatedBytes);
      const percent =
        state.reportedSize > 0
          ? Math.min(100, Math.max(0, Math.floor((downloadedBytes / state.reportedSize) * 100)))
          : null;
      setOptimisticProgress({ downloadedBytes, percent });
    }, 100);
  }

  function stopJobPolling() {
    if (jobPollTimeoutRef.current) {
      window.clearTimeout(jobPollTimeoutRef.current);
      jobPollTimeoutRef.current = null;
    }
  }

  function resetArchiveView() {
    setSession(null);
    setActiveJob(null);
    stopOptimisticProgress();
    setSelectedPath('');
    setTextPreview('');
    setSelectedImageSrc('');
    setOversizePrompt(null);
    setSlideshowOpen(false);
    setThumbnailStripExpanded(false);
    setIsLoading(false);
    textPreviewCacheRef.current.clear();
    clearImagePreviewCache();
  }

  async function clearArchive(removeRemoteSession = true) {
    const activeSessionId = latestSessionIdRef.current;
    const activeJobId = latestJobIdRef.current;

    closeJobEvents();
    stopJobPolling();
    latestSessionIdRef.current = '';
    latestJobIdRef.current = '';
    hydrationRef.current = { sessionId: '', promise: null };
    resetArchiveView();

    if (removeRemoteSession && activeSessionId) {
      await fetch(`/api/sessions/${activeSessionId}`, { method: 'DELETE' }).catch(() => {});
    }

    if (activeJobId) {
      await fetch(`/api/session-jobs/${activeJobId}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  function clearImagePreviewCache() {
    imagePreviewCacheRef.current.forEach((value) => {
      if (value?.objectUrl) {
        URL.revokeObjectURL(value.objectUrl);
      }
    });
    imagePreviewCacheRef.current.clear();
  }

  async function loadImagePreview(imagePath, quality) {
    if (!session?.id || !imagePath) {
      return '';
    }

    const cacheKey = getImageCacheKey(session.id, imagePath, quality);
    const existing = imagePreviewCacheRef.current.get(cacheKey);

    if (existing?.objectUrl) {
      return existing.objectUrl;
    }

    if (existing?.promise) {
      return existing.promise;
    }

    const request = fetch(buildFileUrl(session.id, imagePath, { imagePreview: true, quality }))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Could not load image preview.');
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        imagePreviewCacheRef.current.set(cacheKey, { objectUrl, touchedAt: Date.now() });
        return objectUrl;
      })
      .catch((error) => {
        imagePreviewCacheRef.current.delete(cacheKey);
        throw error;
      });

    imagePreviewCacheRef.current.set(cacheKey, { promise: request, touchedAt: Date.now() });
    return request;
  }

  async function hydrateSession(sessionId, nextUrl) {
    if (!sessionId) {
      return null;
    }

    if (hydrationRef.current.sessionId === sessionId && hydrationRef.current.promise) {
      return hydrationRef.current.promise;
    }

    const previousSessionId = latestSessionIdRef.current;
    const request = (async () => {
      let lastError = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(`/api/sessions/${sessionId}/tree`);
        const payload = await response.json().catch(() => ({}));

        if (response.ok) {
          if (previousSessionId && previousSessionId !== sessionId) {
            fetch(`/api/sessions/${previousSessionId}`, { method: 'DELETE' }).catch(() => {});
          }

          latestSessionIdRef.current = payload.id;
          setSession(payload);
          setZipUrl(nextUrl);
          setSelectedPath(payload.firstFilePath || payload.tree.path);
          setTextPreview('');
          setSelectedImageSrc('');
          setOversizePrompt(null);
          setError('');
          textPreviewCacheRef.current.clear();
          clearImagePreviewCache();
          return payload;
        }

        lastError = new Error(payload.error || 'Could not open ZIP URL.');
        if (response.status !== 404 || attempt === 2) {
          throw lastError;
        }

        await wait(250 * (attempt + 1));
      }

      throw lastError || new Error('Could not open ZIP URL.');
    })();

    hydrationRef.current = { sessionId, promise: request };

    try {
      return await request;
    } finally {
      if (hydrationRef.current.sessionId === sessionId) {
        hydrationRef.current = { sessionId: '', promise: null };
      }
    }
  }

  async function handleJobSnapshot(payload, nextUrl) {
    latestJobIdRef.current = payload?.id || '';
    setActiveJob(payload);

    if (payload?.phase === 'downloading' && !isTerminalJobStatus(payload.status)) {
      startOptimisticProgressFromJob(payload);
    } else {
      stopOptimisticProgress();
    }

    if (payload?.sessionId) {
      await hydrateSession(payload.sessionId, nextUrl);
    }

    if (payload.status === 'awaiting_confirmation') {
      setOversizePrompt({ jobId: payload.id, reportedSize: payload.reportedSize, limit: 1024 * 1024 * 1024 });
      setIsLoading(false);
      return;
    }

    if (payload.status === 'ready') {
      closeJobEvents();
      stopJobPolling();
      latestJobIdRef.current = '';
      setOversizePrompt(null);
      setActiveJob(null);
      setIsLoading(false);
      return;
    }

    if (payload.status === 'error') {
      closeJobEvents();
      stopJobPolling();
      latestJobIdRef.current = '';
      setActiveJob(null);
      setError(payload.error || 'Could not process this ZIP file.');
      setIsLoading(false);
      return;
    }

    if (payload.status === 'cancelled') {
      closeJobEvents();
      stopJobPolling();
      latestJobIdRef.current = '';
      setActiveJob(null);
      setIsLoading(false);
    }
  }

  function startJobPolling(jobId, nextUrl) {
    stopJobPolling();

    async function poll() {
      if (!jobId || latestJobIdRef.current !== jobId) {
        return;
      }

      try {
        const response = await fetch(`/api/session-jobs/${jobId}`);

        if (response.status === 404) {
          stopJobPolling();
          if (!latestSessionIdRef.current) {
            setActiveJob(null);
            setIsLoading(false);
            setError('Archive loading was interrupted before the UI could refresh.');
          }
          return;
        }

        const payload = await response.json();
        await handleJobSnapshot(payload, nextUrl);

        if (!isTerminalJobStatus(payload.status) && latestJobIdRef.current === jobId) {
          jobPollTimeoutRef.current = window.setTimeout(poll, 1500);
        }
      } catch {
        if (latestJobIdRef.current === jobId) {
          jobPollTimeoutRef.current = window.setTimeout(poll, 2000);
        }
      }
    }

    jobPollTimeoutRef.current = window.setTimeout(poll, 1500);
  }

  function attachJobEvents(jobId, nextUrl) {
    closeJobEvents();

    const source = new EventSource(`/api/session-jobs/${jobId}/events`);
    eventSourceRef.current = source;

    const handleSnapshot = async (event) => {
      const payload = JSON.parse(event.data);
      await handleJobSnapshot(payload, nextUrl);
    };

    source.addEventListener('progress', (event) => {
      handleSnapshot(event).catch((jobError) => {
        setError(jobError.message);
        setIsLoading(false);
      });
    });

    source.addEventListener('confirmation', (event) => {
      handleSnapshot(event).catch((jobError) => {
        setError(jobError.message);
        setIsLoading(false);
      });
    });

    source.addEventListener('ready', (event) => {
      handleSnapshot(event).catch((jobError) => {
        setError(jobError.message);
        setIsLoading(false);
      });
    });

    source.addEventListener('job-error', (event) => {
      handleSnapshot(event).catch((jobError) => {
        setError(jobError.message);
        setIsLoading(false);
      });
    });

    source.addEventListener('cancelled', (event) => {
      handleSnapshot(event).catch((jobError) => {
        setError(jobError.message);
        setIsLoading(false);
      });
    });

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        closeJobEvents();
        return;
      }

      closeJobEvents();
      startJobPolling(jobId, nextUrl);
    });
  }

  async function loadSession(url, confirmOversize = false) {
    setIsLoading(true);
    setError('');
    setOversizePrompt(null);
    setSlideshowOpen(false);
    setThumbnailStripExpanded(false);

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, confirmOversize })
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || 'Could not open ZIP URL.');
      }
      latestJobIdRef.current = payload.jobId;
      setActiveJob(payload);
      startJobPolling(payload.jobId, url);
      attachJobEvents(payload.jobId, url);
    } catch (requestError) {
      setError(requestError.message);
      latestJobIdRef.current = '';
      setActiveJob(null);
      stopJobPolling();
      closeJobEvents();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!zipUrl.trim()) {
      setError('Paste a public ZIP URL to start browsing.');
      return;
    }
    await loadSession(zipUrl.trim(), false);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('zip-image-viewer-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!flatData || !sortedTree) {
      return;
    }

    if (!selectedPath || !flatData.nodesByPath.has(selectedPath)) {
      setSelectedPath(getFirstFilePath(sortedTree));
    }
  }, [flatData, selectedPath, sortedTree]);

  useEffect(() => {
    if (!selectedNode || !session || selectedKind !== 'text') {
      setTextPreview('');
      return;
    }

    let cancelled = false;
    const cacheKey = `${session.id}:${selectedNode.path}`;

    async function fetchTextPreview() {
      try {
        const cached = textPreviewCacheRef.current.get(cacheKey);
        if (cached) {
          if (!cancelled) {
            setTextPreview(cached);
          }
          return;
        }

        const response = await fetch(selectedPreviewUrl);
        if (!response.ok) {
          throw new Error('Could not read this file.');
        }
        const content = await response.text();
        textPreviewCacheRef.current.set(cacheKey, content);
        if (!cancelled) {
          setTextPreview(content);
        }
      } catch (previewError) {
        if (!cancelled) {
          setTextPreview(`Preview unavailable: ${previewError.message}`);
        }
      }
    }

    fetchTextPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedKind, selectedNode, selectedPreviewUrl, session]);

  useEffect(() => {
    if (!selectedNode || !session || selectedKind !== 'image') {
      setSelectedImageSrc('');
      return;
    }

    let cancelled = false;

    loadImagePreview(selectedNode.path, previewQuality)
      .then((objectUrl) => {
        if (!cancelled) {
          setSelectedImageSrc(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedImageSrc(selectedImagePreviewUrl);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewQuality, selectedImagePreviewUrl, selectedKind, selectedNode, session]);

  useEffect(() => {
    latestSessionIdRef.current = session?.id || '';
  }, [session]);

  useEffect(() => {
    latestJobIdRef.current = activeJob?.id || '';
  }, [activeJob]);

  useEffect(() => {
    return () => {
      closeJobEvents();
      stopJobPolling();
      stopOptimisticProgress();
      clearImagePreviewCache();
      textPreviewCacheRef.current.clear();
      if (latestSessionIdRef.current) {
        fetch(`/api/sessions/${latestSessionIdRef.current}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      }
      if (latestJobIdRef.current) {
        fetch(`/api/session-jobs/${latestJobIdRef.current}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      const activeElement = document.activeElement;
      const activeTag = activeElement?.tagName;
      if (
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        activeTag === 'SELECT' ||
        activeElement?.closest?.('.custom-dropdown-shell')
      ) {
        return;
      }

      if (currentImageIndex === -1) {
        if (event.key === 'Escape') {
          setSlideshowOpen(false);
        }
        return;
      }

      if (event.key === 'ArrowRight') {
        const nextPath = nextImagePath;
        if (nextPath) {
          event.preventDefault();
          setSelectedPath(nextPath);
        }
      }

      if (event.key === 'ArrowLeft') {
        const prevPath = previousImagePath;
        if (prevPath) {
          event.preventDefault();
          setSelectedPath(prevPath);
        }
      }

      if (slideshowOpen && event.key === 'Home' && currentFolderImages[0]) {
        event.preventDefault();
        setSelectedPath(currentFolderImages[0]);
      }

      if (slideshowOpen && event.key === 'End' && currentFolderImages[currentFolderImages.length - 1]) {
        event.preventDefault();
        setSelectedPath(currentFolderImages[currentFolderImages.length - 1]);
      }

      if (!slideshowOpen && selectedKind === 'image' && (event.key === 'Enter' || event.key.toLowerCase() === 'f')) {
        event.preventDefault();
        setSlideshowOpen(true);
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setSlideshowOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentFolderImages, currentImageIndex, nextImagePath, previousImagePath, selectedKind, slideshowOpen]);

  useEffect(() => {
    if (!session || selectedKind !== 'image' || currentImageIndex === -1) {
      return;
    }

    const preloadTargets = [
      currentFolderImages[currentImageIndex + 1] || currentFolderImages[0],
      currentFolderImages[currentImageIndex - 1] || currentFolderImages[currentFolderImages.length - 1],
      currentFolderImages[currentImageIndex + 2] || ''
    ].filter(Boolean);

    const preloaders = preloadTargets.map((imagePath) => {
      loadImagePreview(imagePath, previewQuality).catch(() => '');
      return imagePath;
    });

    return () => {
      preloaders.forEach(() => {});
    };
  }, [currentFolderImages, currentImageIndex, previewQuality, selectedKind, session]);

  useEffect(() => {
    if (!slideshowOpen) {
      setSlideshowChromeHidden(false);
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [slideshowOpen]);

  const slideshowModal =
    slideshowOpen && selectedKind === 'image' && selectedNode
      ? createPortal(
          <div className={`slideshow-overlay ${slideshowChromeHidden ? 'chrome-hidden' : ''}`}>
            <div
              className="slideshow-viewport"
              role="dialog"
              aria-modal="true"
              aria-label={`Slideshow for ${selectedNode.name}`}
            >
              <div className={`slideshow-stage slideshow-fit-${slideshowFitMode}`} onDoubleClick={() => setSlideshowChromeHidden((current) => !current)}>
                <img src={selectedImageSrc || selectedImagePreviewUrl} alt={selectedNode.name} />
              </div>

              <div className="slideshow-floating slideshow-floating-top">
                <div className="slideshow-info-card">
                  <div className="panel-title-group">
                    <p className="panel-label">Folder slideshow</p>
                    <h2 title={selectedNode.name}>{selectedNode.name}</h2>
                    <div className="slideshow-meta">
                      <span>{currentImageIndex + 1} / {currentFolderImages.length}</span>
                      <span>{formatBytes(selectedNode.size)}</span>
                      <span>{formatDate(selectedNode.modifiedAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="slideshow-controls-card">
                  <CustomDropdown
                    id="slideshow-fit-mode"
                    label="Fit mode"
                    value={slideshowFitMode}
                    options={SLIDESHOW_FIT_OPTIONS}
                    onChange={setSlideshowFitMode}
                    className="slideshow-fit-shell"
                  />

                  <div className="slideshow-actions">
                    <button className="ghost-button" type="button" onClick={() => setSelectedPath(currentFolderImages[0])}>
                      First
                    </button>
                    <button className="ghost-button" type="button" onClick={() => setSelectedPath(currentFolderImages[currentFolderImages.length - 1])}>
                      Last
                    </button>
                    <button className="ghost-button" type="button" onClick={() => setSlideshowChromeHidden(true)}>
                      Hide UI
                    </button>
                    <button className="ghost-button" type="button" onClick={() => setSlideshowOpen(false)}>
                      Close
                    </button>
                  </div>
                </div>
              </div>

              <div className="slideshow-floating slideshow-floating-nav" aria-hidden={slideshowChromeHidden}>
                <button
                  className="nav-button nav-button-left"
                  type="button"
                  aria-label="Previous image"
                  onClick={() => setSelectedPath(previousImagePath)}
                >
                  {'<'}
                </button>
                <button
                  className="nav-button nav-button-right"
                  type="button"
                  aria-label="Next image"
                  onClick={() => setSelectedPath(nextImagePath)}
                >
                  {'>'}
                </button>
              </div>

              <div className="slideshow-floating slideshow-floating-bottom">
                <div className="slideshow-neighbors-card">
                  <div className="slideshow-neighbors">
                    <span>Prev: {previousImageName || 'None'}</span>
                    <span>Next: {nextImageName || 'None'}</span>
                  </div>
                  <div className="navigation-hint">
                    Arrow keys move, Home/End jump, F opens slideshow, Escape closes it, and double-click toggles the overlay.
                  </div>
                </div>
              </div>

              {slideshowChromeHidden ? (
                <button className="slideshow-reveal-button" type="button" onClick={() => setSlideshowChromeHidden(false)}>
                  Show UI
                </button>
              ) : null}
            </div>
          </div>,
          document.body
        )
      : null;

  const visualDownloadedBytes =
    activeJob?.phase === 'downloading' && optimisticProgress
      ? optimisticProgress.downloadedBytes
      : Math.max(0, Number(activeJob?.downloadedBytes) || 0);
  const visualPercent =
    activeJob?.phase === 'downloading' && optimisticProgress
      ? optimisticProgress.percent
      : activeJob?.percent;
  const visualPercentLabel =
    visualPercent == null ? 'Live' : `${Math.max(0, Math.min(100, Math.floor(visualPercent)))}%`;
  const visualProgressWidth =
    visualPercent == null ? undefined : `${Math.max(0, Math.min(100, visualPercent))}%`;
  const transferLabel =
    activeJob?.reportedSize > 0
      ? `${formatTransferBytes(visualDownloadedBytes)} / ${formatTransferBytes(activeJob.reportedSize)}`
      : `${formatTransferBytes(visualDownloadedBytes)} downloaded`;
  const speedLabel = formatSpeed(activeJob?.downloadSpeedBytesPerSec);

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-one" />
      <div className="backdrop backdrop-two" />

      <main className="workspace">
        <section className="hero-panel">
          <div className="hero-topbar">
            <div>
              <p className="eyebrow">ZIP image and file explorer</p>
              <h1>Archive Atlas</h1>
              <p className="hero-copy">
                Paste a public ZIP URL, let the server unpack it, then browse the folder structure with a fast viewer and
                image-first navigation.
              </p>
            </div>
            <button className="ghost-button theme-toggle" type="button" onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}>
              {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            </button>
          </div>

          <form className="url-form" onSubmit={handleSubmit}>
            <label className="input-shell" htmlFor="zip-url">
              <span className="input-label">Public ZIP URL</span>
              <input
                id="zip-url"
                type="url"
                placeholder="https://example.com/archive.zip"
                value={zipUrl}
                onChange={(event) => setZipUrl(event.target.value)}
                autoComplete="off"
              />
            </label>

            <button className="primary-button" type="submit" disabled={isLoading}>
              {activeJob ? 'Loading archive...' : isLoading ? 'Opening archive...' : 'Open archive'}
            </button>
          </form>

          {activeJob ? (
            <div className="progress-card" aria-live="polite">
              <div className="progress-card-head">
                <strong>{activeJob.phase === 'extracting' ? 'Preparing archive' : 'Downloading archive'}</strong>
                <span>{visualPercentLabel}</span>
              </div>
              <div className={`progress-bar-shell ${visualPercent == null ? 'indeterminate' : ''}`}>
                <div
                  className="progress-bar-fill"
                  style={visualPercent == null ? undefined : { width: visualProgressWidth }}
                />
              </div>
              <div className="progress-stats-grid">
                <div className="progress-stat-cell">
                  <span className="progress-stat-label">Transferred</span>
                  <strong>{transferLabel}</strong>
                </div>
                <div className="progress-stat-cell">
                  <span className="progress-stat-label">Speed</span>
                  <strong>{speedLabel}</strong>
                </div>
              </div>
              <div className="progress-meta-row">
                <span>{formatProgressMessage(activeJob)}</span>
                <button className="ghost-button compact-button" type="button" onClick={() => clearArchive(true)}>
                  Cancel load
                </button>
              </div>
            </div>
          ) : null}

          <div className="status-row">
            <div className="status-pill">Port 8080 ready</div>
            <div className="status-pill">1 GB prompt threshold</div>
            <div className="status-pill">Auto-cleanup enabled</div>
            {session ? (
              <button className="ghost-button compact-button" type="button" onClick={() => clearArchive(true)}>
                Clear opened archive
              </button>
            ) : null}
          </div>

          {error ? <div className="message-card error">{error}</div> : null}
          {oversizePrompt ? (
            <div className="message-card warning">
              <div>
                This archive reports {formatBytes(oversizePrompt.reportedSize)}. Continue downloading anyway?
              </div>
              <div className="message-actions">
                <button className="ghost-button" type="button" onClick={() => setOversizePrompt(null)}>
                  Cancel
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={async () => {
                    if (!oversizePrompt?.jobId) {
                      return;
                    }
                    setIsLoading(true);
                    setOversizePrompt(null);
                    await fetch(`/api/session-jobs/${oversizePrompt.jobId}/confirm`, { method: 'POST' }).catch(() => {});
                  }}
                >
                  Proceed download
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="viewer-grid">
          <aside className="sidebar-panel">
            <div className="panel-header panel-header-stackable explorer-header">
              <div className="panel-title-group explorer-title-group">
                <p className="panel-label">Explorer</p>
                <h2 title={sortedTree?.name || 'No archive loaded'}>{sortedTree?.name || 'No archive loaded'}</h2>
              </div>
              <div className="sidebar-header-actions">
                {session ? <span className="panel-chip">{session.stats.fileCount} files</span> : null}
              </div>
              <CustomDropdown
                id="sort-mode"
                label="Sort"
                value={sortMode}
                options={SORT_OPTIONS}
                onChange={setSortMode}
                className="toolbar-select-shell-wide explorer-sort-shell"
              />
            </div>

            <div className="sort-caption">
              {sortMode === 'natural-tail'
                ? 'Number trail mode keeps names like file 2, file 10, file 11 in number order.'
                : sortMode.startsWith('date')
                  ? 'Date sorting uses ZIP entry modified times when the archive provides them.'
                  : 'Sorting affects explorer order, preview arrows, thumbnails, and slideshow navigation.'}
            </div>

            <div className="tree-scroll">
              {sortedTree ? (
                <TreeNode
                  node={sortedTree}
                  selectedPath={selectedPath}
                  sessionId={session.id}
                  folderPreview={flatData.folderPreview}
                  folderImages={flatData.folderImages}
                  onSelect={(node) => {
                    if (node.type === 'file') {
                      setSelectedPath(node.path);
                    }
                  }}
                />
              ) : (
                <div className="empty-card">
                  <strong>Ready to unpack</strong>
                  <p>Load a ZIP URL to inspect folders, preview images, and move across image sets with arrow keys.</p>
                </div>
              )}
            </div>
          </aside>

          <section className="preview-panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <p className="panel-label">Preview</p>
                <h2 title={selectedNode?.name || 'Select a file'}>{selectedNode?.name || 'Select a file'}</h2>
              </div>
              {selectedNode?.type === 'file' ? (
                <div className="panel-actions">
                  {selectedKind === 'image' ? (
                    <button className="ghost-button" type="button" onClick={() => setSlideshowOpen(true)}>
                      Slideshow
                    </button>
                  ) : null}
                  <a className="ghost-button inline-link" href={selectedFileUrl} target="_blank" rel="noreferrer">
                    Open raw
                  </a>
                </div>
              ) : null}
            </div>

            {!selectedNode || selectedNode.type !== 'file' ? (
              <div className="empty-card preview-empty">
                <strong>Nothing selected</strong>
                <p>Choose a file from the sidebar to start previewing its contents.</p>
              </div>
            ) : null}

            {selectedNode?.type === 'file' && selectedKind === 'image' ? (
              <div className="preview-stage">
                <div className="preview-toolbar">
                  <span>{formatBytes(selectedNode.size)}</span>
                  <span>
                    {currentImageIndex >= 0 ? `${currentImageIndex + 1} / ${currentFolderImages.length} in folder` : 'Single image'}
                  </span>
                  <CustomDropdown
                    id="preview-quality"
                    label="Preview quality"
                    value={previewQuality}
                    options={PREVIEW_QUALITY_OPTIONS}
                    onChange={setPreviewQuality}
                  />
                  <span>{formatDate(selectedNode.modifiedAt)}</span>
                </div>
                <div className="image-frame">
                  <img src={selectedImageSrc || selectedImagePreviewUrl} alt={selectedNode.name} />
                </div>
                {currentFolderImageItems.length > 1 ? (
                  <div className={`thumbnail-strip-shell ${thumbnailStripExpanded ? 'expanded' : 'collapsed'}`}>
                    <div className="thumbnail-strip-header">
                      <div>
                        <strong>Folder thumbnails</strong>
                        <div className="thumbnail-strip-copy">
                          {thumbnailStripExpanded
                            ? `Showing all ${currentFolderImageItems.length} sibling images.`
                            : 'Showing nearby images around the current selection.'}
                        </div>
                      </div>
                      <button className="ghost-button" type="button" onClick={() => setThumbnailStripExpanded((current) => !current)}>
                        {thumbnailStripExpanded ? 'Collapse strip' : 'Expand strip'}
                      </button>
                    </div>
                    <div className={`thumbnail-strip ${thumbnailStripExpanded ? 'expanded' : 'collapsed'}`} role="list" aria-label="Folder images">
                      {visibleThumbnailItems.map((item) => (
                        <button
                          key={item.path}
                          type="button"
                          className={`thumbnail-card ${item.path === selectedPath ? 'active' : ''}`}
                          onClick={() => setSelectedPath(item.path)}
                        >
                          <img src={item.thumbnailUrl} alt={item.name} loading="lazy" />
                          <span>{item.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="navigation-hint">Use left and right arrow keys to move through sibling images in the active sort order.</div>
              </div>
            ) : null}

            {selectedNode?.type === 'file' && selectedKind === 'text' ? (
              <div className="text-preview">
                <div className="preview-toolbar">
                  <span>{formatBytes(selectedNode.size)}</span>
                  <span>{selectedNode.extension.toUpperCase()} preview</span>
                  <span>{formatDate(selectedNode.modifiedAt)}</span>
                </div>
                <pre>{textPreview || 'Loading file...'}</pre>
              </div>
            ) : null}

            {selectedNode?.type === 'file' && selectedKind === 'video' ? (
              <div className="preview-stage">
                <div className="preview-toolbar">
                  <span>{formatBytes(selectedNode.size)}</span>
                  <span>{selectedNode.extension.toUpperCase()} stream preview</span>
                  <span>{formatDate(selectedNode.modifiedAt)}</span>
                </div>
                <div className="image-frame media-frame">
                  <video className="video-player" src={selectedFileUrl} controls preload="metadata">
                    Your browser cannot play this video inline.
                  </video>
                </div>
                <div className="navigation-hint">Video playback streams from the extracted file and supports browser seeking when the server serves ranges.</div>
              </div>
            ) : null}

            {selectedNode?.type === 'file' && selectedKind === 'binary' ? (
              <div className="empty-card preview-empty">
                <strong>Binary file</strong>
                <p>This file type does not have an inline preview yet. Open the raw file in a new tab or download it.</p>
              </div>
            ) : null}
          </section>
        </section>
      </main>
      {slideshowModal}
    </div>
  );
}

export default App;
