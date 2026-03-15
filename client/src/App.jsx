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
  { value: 'natural-tail', label: 'Number tail' }
];
const PREVIEW_QUALITY_OPTIONS = [
  { value: 'low', label: 'Low preview' },
  { value: 'balanced', label: 'Balanced preview' },
  { value: 'high', label: 'High preview' }
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
  const [sortMode, setSortMode] = useState('name-asc');
  const [previewQuality, setPreviewQuality] = useState('balanced');
  const [thumbnailStripExpanded, setThumbnailStripExpanded] = useState(false);
  const [textPreview, setTextPreview] = useState('');
  const [selectedImageSrc, setSelectedImageSrc] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [oversizePrompt, setOversizePrompt] = useState(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const textPreviewCacheRef = useRef(new Map());
  const imagePreviewCacheRef = useRef(new Map());

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

  async function clearArchive(removeRemoteSession = true) {
    const activeSessionId = session?.id;

    setSession(null);
    setSelectedPath('');
    setTextPreview('');
    setSelectedImageSrc('');
    setOversizePrompt(null);
    setSlideshowOpen(false);
    setThumbnailStripExpanded(false);
    textPreviewCacheRef.current.clear();
    clearImagePreviewCache();

    if (removeRemoteSession && activeSessionId) {
      await fetch(`/api/sessions/${activeSessionId}`, { method: 'DELETE' }).catch(() => {});
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

      if (payload.requiresConfirmation) {
        setOversizePrompt(payload);
        return;
      }

      if (session?.id) {
        fetch(`/api/sessions/${session.id}`, { method: 'DELETE' }).catch(() => {});
      }

      setSession(payload);
      setZipUrl(url);
      setSelectedPath(payload.firstFilePath || payload.tree.path);
      setTextPreview('');
      setSelectedImageSrc('');
      textPreviewCacheRef.current.clear();
      clearImagePreviewCache();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
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
    return () => {
      clearImagePreviewCache();
      textPreviewCacheRef.current.clear();
      if (session?.id) {
        fetch(`/api/sessions/${session.id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      }
    };
  }, [session]);

  useEffect(() => {
    function onKeyDown(event) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') {
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
          <div className="slideshow-overlay" onClick={() => setSlideshowOpen(false)}>
            <div
              className="slideshow-card"
              role="dialog"
              aria-modal="true"
              aria-label={`Slideshow for ${selectedNode.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="slideshow-topbar">
                <div className="panel-title-group">
                  <p className="panel-label">Folder slideshow</p>
                  <h2 title={selectedNode.name}>{selectedNode.name}</h2>
                  <div className="slideshow-meta">
                    <span>{currentImageIndex + 1} / {currentFolderImages.length}</span>
                    <span>{formatBytes(selectedNode.size)}</span>
                    <span>{formatDate(selectedNode.modifiedAt)}</span>
                  </div>
                </div>
                <div className="slideshow-actions">
                  <button className="ghost-button" type="button" onClick={() => setSelectedPath(currentFolderImages[0])}>
                    First
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setSelectedPath(currentFolderImages[currentFolderImages.length - 1])}>
                    Last
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setSlideshowOpen(false)}>
                    Close
                  </button>
                </div>
              </div>

              <div className="slideshow-body">
                <button
                  className="nav-button"
                  type="button"
                  aria-label="Previous image"
                  onClick={() => setSelectedPath(previousImagePath)}
                >
                  {'<'}
                </button>
                <div className="slideshow-stage">
                  <img src={selectedImageSrc || selectedImagePreviewUrl} alt={selectedNode.name} />
                </div>
                <button
                  className="nav-button"
                  type="button"
                  aria-label="Next image"
                  onClick={() => setSelectedPath(nextImagePath)}
                >
                  {'>'}
                </button>
              </div>
              <div className="slideshow-footer">
                <div className="slideshow-neighbors">
                  <span>Prev: {previousImageName || 'None'}</span>
                  <span>Next: {nextImageName || 'None'}</span>
                </div>
                <div className="navigation-hint">Arrow keys move, Home/End jump, Enter or F opens slideshow, Escape closes it.</div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

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
              {isLoading ? 'Opening archive...' : 'Open archive'}
            </button>
          </form>

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
                <button className="primary-button" type="button" onClick={() => loadSession(zipUrl, true)}>
                  Proceed download
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="viewer-grid">
          <aside className="sidebar-panel">
            <div className="panel-header panel-header-stackable">
              <div className="panel-title-group">
                <p className="panel-label">Explorer</p>
                <h2 title={sortedTree?.name || 'No archive loaded'}>{sortedTree?.name || 'No archive loaded'}</h2>
              </div>
              <div className="sidebar-header-actions">
                {session ? <span className="panel-chip">{session.stats.fileCount} files</span> : null}
                <label className="toolbar-select-shell" htmlFor="sort-mode">
                  <span className="toolbar-label">Sort</span>
                  <select id="sort-mode" value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="sort-caption">
              {sortMode === 'natural-tail'
                ? 'Numeric tail mode keeps names like file 2, file 10, file 11 in number order.'
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
                  <label className="toolbar-select-shell" htmlFor="preview-quality">
                    <span className="toolbar-label">Preview quality</span>
                    <select id="preview-quality" value={previewQuality} onChange={(event) => setPreviewQuality(event.target.value)}>
                      {PREVIEW_QUALITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
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
