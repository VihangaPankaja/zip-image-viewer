import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import videojs from "video.js";
import { openJobSocket } from "./lib/jobSocket";
import { WorkspaceTabs, type WorkspaceTabId } from "./components/WorkspaceTabs";
import { ExplorerTablePanel } from "./components/ExplorerTablePanel";
import { GlobalSettingsSheet } from "./components/GlobalSettingsSheet";
import { TreeExplorer } from "./components/TreeExplorer";

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "svg",
  "bmp",
  "avif",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "aac", "m4a", "flac"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "csv",
  "log",
  "xml",
  "yml",
  "yaml",
  "js",
  "jsx",
  "ts",
  "tsx",
  "html",
  "css",
]);

const STRIP_THUMB_SIZE = 220;
const SORT_OPTIONS = [
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "date-asc", label: "Date oldest" },
  { value: "date-desc", label: "Date newest" },
  { value: "natural-tail", label: "Number trail" },
];
const PREVIEW_QUALITY_OPTIONS = [
  { value: "low", label: "Low preview" },
  { value: "balanced", label: "Balanced preview" },
  { value: "high", label: "High preview" },
];
const SLIDESHOW_FIT_OPTIONS = [
  { value: "best-fit", label: "Best fit" },
  { value: "fit-width", label: "Fit width" },
  { value: "fit-height", label: "Fit height" },
];
const DOWNLOAD_THREAD_MODE_OPTIONS = [
  { value: "auto", label: "Auto (recommended)" },
  { value: "single", label: "Single stream" },
  { value: "segmented", label: "Segmented" },
];
const DOWNLOAD_RETRY_OPTIONS = [
  { value: 0, label: "No retry" },
  { value: 3, label: "3 retries" },
  { value: 5, label: "5 retries" },
  { value: 8, label: "8 retries" },
  { value: -1, label: "Unlimited" },
];
const VIDEO_TRANSCODE_QUALITY_OPTIONS = [
  { value: "720p", label: "720p (default)" },
  { value: "480p", label: "480p" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "2160p", label: "2160p" },
  { value: "360p", label: "360p" },
  { value: "source", label: "Original source" },
];
const WORKSPACE_TABS: Array<{ value: WorkspaceTabId; label: string }> = [
  { value: "download", label: "Download" },
  { value: "preview", label: "Preview" },
  { value: "explorer", label: "Explorer" },
];
const DEFAULT_DOWNLOAD_SETTINGS = {
  threadMode: "auto",
  threadCount: 3,
  enableMultithread: true,
  enableResume: true,
  maxRetries: 3,
  videoQuality: "720p",
};
const NAME_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: false,
});

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatTransferBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "--";
  return `${formatTransferBytes(bytesPerSec)}/s`;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeDownloadSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const threadMode =
    source.threadMode === "auto" ||
    source.threadMode === "single" ||
    source.threadMode === "segmented"
      ? source.threadMode
      : DEFAULT_DOWNLOAD_SETTINGS.threadMode;

  return {
    threadMode,
    threadCount: clampNumber(
      source.threadCount,
      1,
      8,
      DEFAULT_DOWNLOAD_SETTINGS.threadCount,
    ),
    enableMultithread:
      source.enableMultithread == null
        ? DEFAULT_DOWNLOAD_SETTINGS.enableMultithread
        : Boolean(source.enableMultithread),
    enableResume:
      source.enableResume == null
        ? DEFAULT_DOWNLOAD_SETTINGS.enableResume
        : Boolean(source.enableResume),
    maxRetries:
      Number.parseInt(source.maxRetries, 10) === -1
        ? -1
        : clampNumber(
            source.maxRetries,
            0,
            8,
            DEFAULT_DOWNLOAD_SETTINGS.maxRetries,
          ),
    videoQuality: VIDEO_TRANSCODE_QUALITY_OPTIONS.some(
      (option) =>
        option.value === String(source.videoQuality || "").toLowerCase(),
    )
      ? String(source.videoQuality).toLowerCase()
      : DEFAULT_DOWNLOAD_SETTINGS.videoQuality,
  };
}

function normalizeDownloadOptions(value): DownloadOptions {
  const source = value && typeof value === "object" ? value : {};
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

  const legacy = normalizeDownloadSettings(source);
  const timeoutMs = clampNumber(retrySource.timeoutMs, 5000, 180000, 30000);
  const headers =
    requestSource.headers && typeof requestSource.headers === "object"
      ? Object.fromEntries(
          Object.entries(requestSource.headers)
            .filter(([key, val]) => key && val != null)
            .map(([key, val]) => [String(key), String(val)]),
        )
      : {};

  return {
    transport: {
      mode:
        transportSource.mode === "single" ||
        transportSource.mode === "segmented" ||
        transportSource.mode === "auto"
          ? transportSource.mode
          : legacy.threadMode,
      threads: clampNumber(transportSource.threads, 1, 8, legacy.threadCount),
      multithread:
        transportSource.multithread == null
          ? legacy.enableMultithread
          : Boolean(transportSource.multithread),
      resume:
        transportSource.resume == null
          ? legacy.enableResume
          : Boolean(transportSource.resume),
    },
    retry: {
      maxRetries:
        Number.parseInt(retrySource.maxRetries, 10) === -1
          ? -1
          : clampNumber(retrySource.maxRetries, 0, 8, legacy.maxRetries),
      timeoutMs,
    },
    media: {
      videoQuality: VIDEO_TRANSCODE_QUALITY_OPTIONS.some(
        (option) =>
          option.value === String(mediaSource.videoQuality || "").toLowerCase(),
      )
        ? String(mediaSource.videoQuality).toLowerCase()
        : legacy.videoQuality,
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

function downloadOptionsToLegacySettings(options: DownloadOptions) {
  return {
    threadMode: options.transport.mode,
    threadCount: options.transport.threads,
    enableMultithread: options.transport.multithread,
    enableResume: options.transport.resume,
    maxRetries: options.retry.maxRetries,
    videoQuality: options.media.videoQuality,
  };
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--";
  }

  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

function formatDate(value) {
  if (!value) {
    return "Date unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(value);
}

function classifyNode(node) {
  if (!node || node.type === "directory") return "directory";
  if (IMAGE_EXTENSIONS.has(node.extension)) return "image";
  if (VIDEO_EXTENSIONS.has(node.extension)) return "video";
  if (AUDIO_EXTENSIONS.has(node.extension)) return "audio";
  if (TEXT_EXTENSIONS.has(node.extension)) return "text";
  return "binary";
}

type BuildFileUrlOptions = {
  previewText?: boolean;
  thumbnail?: boolean;
  size?: number;
  imagePreview?: boolean;
  quality?: string;
};

type DownloadOptions = {
  transport: {
    mode: "auto" | "single" | "segmented";
    threads: number;
    multithread: boolean;
    resume: boolean;
  };
  retry: {
    maxRetries: number;
    timeoutMs: number;
  };
  media: {
    videoQuality: string;
  };
  extraction: {
    enabled: boolean;
  };
  request: {
    headers: Record<string, string>;
  };
};

const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
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

function buildFileUrl(sessionId, filePath, options: BuildFileUrlOptions = {}) {
  if (!sessionId || !filePath) {
    return "";
  }

  const params = new URLSearchParams({ path: filePath });
  if (options.previewText) {
    params.set("preview", "1");
  }
  if (options.thumbnail) {
    params.set("thumbnail", "1");
    params.set("size", String(options.size || STRIP_THUMB_SIZE));
  }
  if (options.imagePreview) {
    params.set("imagePreview", "1");
    params.set("quality", options.quality || "balanced");
  }

  return `/api/sessions/${sessionId}/file?${params.toString()}`;
}

function getNameBase(name) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function parseTrailingNumber(name) {
  const baseName = getNameBase(name).trim();
  const match = baseName.match(/^(.*?)(?:[\s._-]*\(?([0-9]+)\)?)$/);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1].trim(),
    number: Number(match[2]),
  };
}

function compareByName(left, right) {
  return NAME_COLLATOR.compare(left.name, right.name);
}

function compareByNaturalTail(left, right) {
  const leftTail = parseTrailingNumber(left.name);
  const rightTail = parseTrailingNumber(right.name);

  if (leftTail && rightTail) {
    const prefixCompare = NAME_COLLATOR.compare(
      leftTail.prefix,
      rightTail.prefix,
    );
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
    return direction === "asc"
      ? leftValue - rightValue
      : rightValue - leftValue;
  }
  return compareByName(left, right);
}

function compareNodes(left, right, sortMode) {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }

  switch (sortMode) {
    case "name-desc":
      return compareByName(right, left);
    case "date-asc":
      return compareByDate(left, right, "asc");
    case "date-desc":
      return compareByDate(left, right, "desc");
    case "natural-tail":
      return compareByNaturalTail(left, right);
    case "name-asc":
    default:
      return compareByName(left, right);
  }
}

function cloneAndSortTree(node, sortMode) {
  if (node.type !== "directory") {
    return { ...node };
  }

  const children = node.children.map((child) =>
    cloneAndSortTree(child, sortMode),
  );
  children.sort((left, right) => compareNodes(left, right, sortMode));

  return {
    ...node,
    children,
  };
}

function flattenTree(tree) {
  const nodesByPath = new Map();
  const folderImages = new Map();
  const folderPreview = new Map();

  function walk(node) {
    nodesByPath.set(node.path, node);
    if (node.type === "directory") {
      const imageChildren = node.children.filter(
        (child) => classifyNode(child) === "image",
      );
      folderImages.set(
        node.path,
        imageChildren.map((child) => child.path),
      );
      folderPreview.set(node.path, imageChildren[0]?.path || "");
      node.children.forEach(walk);
    }
  }

  walk(tree);
  return { nodesByPath, folderImages, folderPreview };
}

function getFirstFilePath(node) {
  if (!node) {
    return "";
  }

  if (node.type === "file") {
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
    return "";
  }

  const nextIndex = (currentIndex + delta + items.length) % items.length;
  return items[nextIndex] || "";
}

function formatProgressMessage(job) {
  if (!job) {
    return "";
  }

  if (job.message) {
    return job.message;
  }

  if (job.phase === "downloading" && job.reportedSize > 0) {
    if (job.isStalled) {
      return "Download stalled, waiting for data or retry.";
    }
    return `Downloading archive: ${formatTransferBytes(job.downloadedBytes)} of ${formatTransferBytes(job.reportedSize)}`;
  }

  if (job.phase === "downloading") {
    return `Downloading archive: ${formatTransferBytes(job.downloadedBytes)} received`;
  }

  if (job.phase === "extracting") {
    return `Extracting archive: ${job.extractedEntries || 0} of ${job.totalEntries || 0} entries`;
  }

  return "Working on archive...";
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTerminalJobStatus(status) {
  return status === "ready" || status === "error" || status === "cancelled";
}

function CustomDropdown({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const activeOption =
    options.find((option) => option.value === value) || options[0] || null;

  useEffect(() => {
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function onEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={`toolbar-select-shell custom-dropdown-shell ${className}`.trim()}
    >
      <span className="toolbar-label">{label}</span>
      <button
        type="button"
        id={id}
        className={`custom-dropdown-trigger ${open ? "open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{activeOption?.label || "Select"}</span>
        <span className="custom-dropdown-caret">{open ? "^" : "v"}</span>
      </button>

      {open ? (
        <div
          className="custom-dropdown-menu"
          role="listbox"
          aria-labelledby={id}
        >
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`custom-dropdown-option ${isActive ? "active" : ""}`}
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
  const [zipUrl, setZipUrl] = useState("");
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>("download");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") {
      return "dark";
    }
    return window.localStorage.getItem("zip-image-viewer-theme") || "dark";
  });
  const [selectedPath, setSelectedPath] = useState("");
  const [sortMode, setSortMode] = useState("natural-tail");
  const [previewQuality, setPreviewQuality] = useState("balanced");
  const [thumbnailStripExpanded, setThumbnailStripExpanded] = useState(false);
  const [textPreview, setTextPreview] = useState("");
  const [selectedImageSrc, setSelectedImageSrc] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [oversizePrompt, setOversizePrompt] = useState(null);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [explorerModalOpen, setExplorerModalOpen] = useState(false);
  const [slideshowFitMode, setSlideshowFitMode] = useState("best-fit");
  const [slideshowChromeHidden, setSlideshowChromeHidden] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1);
  const [videoVolume, setVideoVolume] = useState(0.9);
  const [keyboardSettings, setKeyboardSettings] = useState(() => {
    if (typeof window === "undefined") {
      return { jumpSeconds: 5, rateStep: 0.25 };
    }

    try {
      const raw = window.localStorage.getItem("zip-shortcut-settings");
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        jumpSeconds: clampNumber(parsed?.jumpSeconds, 1, 30, 5),
        rateStep: Number(parsed?.rateStep) > 0 ? Number(parsed.rateStep) : 0.25,
      };
    } catch {
      return { jumpSeconds: 5, rateStep: 0.25 };
    }
  });
  const [explorerColumns, setExplorerColumns] = useState(() => {
    if (typeof window === "undefined") {
      return { type: true, size: true, date: true, path: true };
    }

    try {
      const raw = window.localStorage.getItem("zip-explorer-columns");
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        type: parsed?.type !== false,
        size: parsed?.size !== false,
        date: parsed?.date !== false,
        path: parsed?.path !== false,
      };
    } catch {
      return { type: true, size: true, date: true, path: true };
    }
  });
  const [downloadOptions, setDownloadOptions] = useState<DownloadOptions>(
    () => {
      if (typeof window === "undefined") {
        return DEFAULT_DOWNLOAD_OPTIONS;
      }

      try {
        const raw = window.localStorage.getItem("zip-download-options");
        const legacy = window.localStorage.getItem("zip-download-settings");
        if (raw) {
          return normalizeDownloadOptions(JSON.parse(raw));
        }
        if (legacy) {
          return normalizeDownloadOptions(JSON.parse(legacy));
        }
        return DEFAULT_DOWNLOAD_OPTIONS;
      } catch {
        return DEFAULT_DOWNLOAD_OPTIONS;
      }
    },
  );
  const downloadSettings = useMemo(
    () => downloadOptionsToLegacySettings(downloadOptions),
    [downloadOptions],
  );
  const textPreviewCacheRef = useRef(new Map());
  const imagePreviewCacheRef = useRef(new Map());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoPlayerRef = useRef<ReturnType<typeof videojs> | null>(null);
  const videoShellRef = useRef<HTMLDivElement | null>(null);
  const [videoQualityOptions, setVideoQualityOptions] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [selectedVideoQuality, setSelectedVideoQuality] = useState("source");
  const jobSocketRef = useRef(null);
  const jobPollTimeoutRef = useRef(null);
  const latestSessionIdRef = useRef("");
  const latestJobIdRef = useRef("");
  const hydrationRef = useRef({ sessionId: "", promise: null });

  const sortedTree = useMemo(() => {
    if (!session?.tree) {
      return null;
    }
    return cloneAndSortTree(session.tree, sortMode);
  }, [session, sortMode]);

  const flatData = useMemo(
    () => (sortedTree ? flattenTree(sortedTree) : null),
    [sortedTree],
  );
  const selectedNode = flatData?.nodesByPath.get(selectedPath) || null;
  const selectedKind = classifyNode(selectedNode);
  const currentFolderImages = selectedNode
    ? flatData?.folderImages.get(selectedNode.parentPath) || []
    : [];
  const currentImageIndex = selectedNode
    ? currentFolderImages.indexOf(selectedNode.path)
    : -1;
  const selectedFileUrl =
    session && selectedNode && selectedNode.type === "file"
      ? buildFileUrl(session.id, selectedNode.path)
      : "";
  const selectedImagePreviewUrl =
    session &&
    selectedNode &&
    selectedNode.type === "file" &&
    selectedKind === "image"
      ? buildFileUrl(session.id, selectedNode.path, {
          imagePreview: true,
          quality: previewQuality,
        })
      : "";
  const selectedPreviewUrl =
    session && selectedNode && selectedNode.type === "file"
      ? buildFileUrl(session.id, selectedNode.path, { previewText: true })
      : "";
  const currentFolderImageItems = currentFolderImages.map((imagePath) => ({
    path: imagePath,
    name:
      flatData?.nodesByPath.get(imagePath)?.name ||
      imagePath.split("/").at(-1) ||
      imagePath,
    url: buildFileUrl(session?.id, imagePath),
    previewUrl: buildFileUrl(session?.id, imagePath, {
      imagePreview: true,
      quality: previewQuality,
    }),
    thumbnailUrl: buildFileUrl(session?.id, imagePath, {
      thumbnail: true,
      size: STRIP_THUMB_SIZE,
    }),
  }));
  const visibleThumbnailItems = thumbnailStripExpanded
    ? currentFolderImageItems
    : getThumbnailWindow(currentFolderImageItems, selectedPath, 2);
  const previousImagePath = getWrappedPath(
    currentFolderImages,
    currentImageIndex,
    -1,
  );
  const nextImagePath = getWrappedPath(
    currentFolderImages,
    currentImageIndex,
    1,
  );
  const previousImageName =
    flatData?.nodesByPath.get(previousImagePath)?.name || "";
  const nextImageName = flatData?.nodesByPath.get(nextImagePath)?.name || "";
  const explorerRows = useMemo(() => {
    if (!flatData || !sortedTree) {
      return [];
    }

    return Array.from(flatData.nodesByPath.values())
      .filter((node) => node.path !== sortedTree.path)
      .sort((left, right) => compareNodes(left, right, sortMode));
  }, [flatData, sortedTree, sortMode]);
  const selectedVideoUrl =
    selectedNode?.type === "file" && selectedKind === "video"
      ? `/api/sessions/${session?.id}/video/play?${new URLSearchParams({
          path: selectedNode.path,
          quality: selectedVideoQuality,
        }).toString()}`
      : "";

  function closeJobEvents() {
    if (jobSocketRef.current) {
      jobSocketRef.current.close();
      jobSocketRef.current = null;
    }
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
    setSelectedPath("");
    setTextPreview("");
    setSelectedImageSrc("");
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
    latestSessionIdRef.current = "";
    latestJobIdRef.current = "";
    hydrationRef.current = { sessionId: "", promise: null };
    resetArchiveView();

    if (removeRemoteSession && activeSessionId) {
      await fetch(`/api/sessions/${activeSessionId}`, {
        method: "DELETE",
      }).catch(() => {});
    }

    if (activeJobId) {
      await fetch(`/api/session-jobs/${activeJobId}`, {
        method: "DELETE",
      }).catch(() => {});
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
      return "";
    }

    const cacheKey = getImageCacheKey(session.id, imagePath, quality);
    const existing = imagePreviewCacheRef.current.get(cacheKey);

    if (existing?.objectUrl) {
      return existing.objectUrl;
    }

    if (existing?.promise) {
      return existing.promise;
    }

    const request = fetch(
      buildFileUrl(session.id, imagePath, { imagePreview: true, quality }),
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Could not load image preview.");
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        imagePreviewCacheRef.current.set(cacheKey, {
          objectUrl,
          touchedAt: Date.now(),
        });
        return objectUrl;
      })
      .catch((error) => {
        imagePreviewCacheRef.current.delete(cacheKey);
        throw error;
      });

    imagePreviewCacheRef.current.set(cacheKey, {
      promise: request,
      touchedAt: Date.now(),
    });
    return request;
  }

  async function hydrateSession(sessionId, nextUrl) {
    if (!sessionId) {
      return null;
    }

    if (
      hydrationRef.current.sessionId === sessionId &&
      hydrationRef.current.promise
    ) {
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
            fetch(`/api/sessions/${previousSessionId}`, {
              method: "DELETE",
            }).catch(() => {});
          }

          latestSessionIdRef.current = payload.id;
          setSession(payload);
          setZipUrl(nextUrl);
          setSelectedPath(payload.firstFilePath || payload.tree.path);
          setTextPreview("");
          setSelectedImageSrc("");
          setOversizePrompt(null);
          setError("");
          textPreviewCacheRef.current.clear();
          clearImagePreviewCache();
          return payload;
        }

        lastError = new Error(payload.error || "Could not open file URL.");
        if (response.status !== 404 || attempt === 2) {
          throw lastError;
        }

        await wait(250 * (attempt + 1));
      }

      throw lastError || new Error("Could not open file URL.");
    })();

    hydrationRef.current = { sessionId, promise: request };

    try {
      return await request;
    } finally {
      if (hydrationRef.current.sessionId === sessionId) {
        hydrationRef.current = { sessionId: "", promise: null };
      }
    }
  }

  async function handleJobSnapshot(payload, nextUrl) {
    latestJobIdRef.current = payload?.id || "";
    setActiveJob(payload);

    if (payload?.sessionId) {
      await hydrateSession(payload.sessionId, nextUrl);
    }

    if (payload.status === "awaiting_confirmation") {
      setOversizePrompt({
        jobId: payload.id,
        reportedSize: payload.reportedSize,
        limit: 1024 * 1024 * 1024,
      });
      setIsLoading(false);
      return;
    }

    if (payload.status === "ready") {
      closeJobEvents();
      stopJobPolling();
      latestJobIdRef.current = "";
      setOversizePrompt(null);
      setActiveJob(null);
      setIsLoading(false);
      return;
    }

    if (payload.status === "error") {
      closeJobEvents();
      stopJobPolling();
      latestJobIdRef.current = "";
      setActiveJob(null);
      setError(payload.error || "Could not process this file.");
      setIsLoading(false);
      return;
    }

    if (payload.status === "cancelled") {
      closeJobEvents();
      stopJobPolling();
      latestJobIdRef.current = "";
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
            setError(
              "Archive loading was interrupted before the UI could refresh.",
            );
          }
          return;
        }

        const payload = await response.json();
        await handleJobSnapshot(payload, nextUrl);

        if (
          !isTerminalJobStatus(payload.status) &&
          latestJobIdRef.current === jobId
        ) {
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

    const socket = openJobSocket(jobId, {
      onJob: (payload) => {
        handleJobSnapshot(payload, nextUrl).catch((jobError) => {
          setError(jobError.message);
          setIsLoading(false);
        });
      },
      onMalformedPayload: () => {
        setError("Realtime update failed.");
        setIsLoading(false);
      },
      onSocketError: () => {
        closeJobEvents();
        startJobPolling(jobId, nextUrl);
      },
      onSocketClose: () => {
        if (!latestJobIdRef.current || latestJobIdRef.current !== jobId) {
          return;
        }

        startJobPolling(jobId, nextUrl);
      },
    });

    jobSocketRef.current = socket;
  }

  async function loadSession(url, confirmOversize = false) {
    setIsLoading(true);
    setError("");
    setOversizePrompt(null);
    setSlideshowOpen(false);
    setThumbnailStripExpanded(false);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          confirmOversize,
          downloadOptions,
          downloadSettings,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Could not open file URL.");
      }
      latestJobIdRef.current = payload.jobId;
      setActiveJob(payload);
      attachJobEvents(payload.jobId, url);
    } catch (requestError) {
      setError(requestError.message);
      latestJobIdRef.current = "";
      setActiveJob(null);
      stopJobPolling();
      closeJobEvents();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!zipUrl.trim()) {
      setError("Paste a public ZIP URL to start browsing.");
      return;
    }
    await loadSession(zipUrl.trim(), false);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("zip-image-viewer-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(
      "zip-download-options",
      JSON.stringify(downloadOptions),
    );
  }, [downloadOptions]);

  useEffect(() => {
    window.localStorage.setItem(
      "zip-explorer-columns",
      JSON.stringify(explorerColumns),
    );
  }, [explorerColumns]);

  useEffect(() => {
    window.localStorage.setItem(
      "zip-shortcut-settings",
      JSON.stringify(keyboardSettings),
    );
  }, [keyboardSettings]);

  useEffect(() => {
    if (!flatData || !sortedTree) {
      return;
    }

    if (!selectedPath || !flatData.nodesByPath.has(selectedPath)) {
      setSelectedPath(getFirstFilePath(sortedTree));
    }
  }, [flatData, selectedPath, sortedTree]);

  useEffect(() => {
    if (!selectedNode || !session || selectedKind !== "text") {
      setTextPreview("");
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
          throw new Error("Could not read this file.");
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
    if (!selectedNode || !session || selectedKind !== "image") {
      setSelectedImageSrc("");
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
  }, [
    previewQuality,
    selectedImagePreviewUrl,
    selectedKind,
    selectedNode,
    session,
  ]);

  useEffect(() => {
    latestSessionIdRef.current = session?.id || "";
  }, [session]);

  useEffect(() => {
    if (selectedKind !== "video" || !videoRef.current) {
      videoPlayerRef.current?.dispose();
      videoPlayerRef.current = null;
      return;
    }

    if (videoPlayerRef.current) {
      return;
    }

    const player = videojs(videoRef.current, {
      controls: true,
      fluid: true,
      preload: "metadata",
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
      controlBar: {
        pictureInPictureToggle: true,
      },
    });
    videoPlayerRef.current = player;

    function onRateChange() {
      setVideoPlaybackRate(Number(player.playbackRate()) || 1);
    }

    function onVolumeChange() {
      setVideoVolume(Math.max(0, Math.min(1, Number(player.volume()) || 0)));
    }

    player.on("ratechange", onRateChange);
    player.on("volumechange", onVolumeChange);

    player.volume(0.9);
    player.playbackRate(1);

    return () => {
      player.off("ratechange", onRateChange);
      player.off("volumechange", onVolumeChange);
      player.dispose();
      if (videoPlayerRef.current === player) {
        videoPlayerRef.current = null;
      }
    };
  }, [selectedKind]);

  useEffect(() => {
    const player = videoPlayerRef.current;
    if (!player || selectedKind !== "video" || !selectedVideoUrl) {
      return;
    }

    player.src({ src: selectedVideoUrl, type: "video/mp4" });
  }, [selectedKind, selectedVideoUrl]);

  useEffect(() => {
    const player = videoPlayerRef.current;
    if (!player || selectedKind !== "video") {
      return;
    }

    if (Math.abs(player.volume() - videoVolume) > 0.01) {
      player.volume(videoVolume);
    }
  }, [selectedKind, videoVolume]);

  useEffect(() => {
    const player = videoPlayerRef.current;
    if (!player || selectedKind !== "video") {
      return;
    }

    if (Math.abs((player.playbackRate() || 1) - videoPlaybackRate) > 0.01) {
      player.playbackRate(videoPlaybackRate);
    }
  }, [selectedKind, videoPlaybackRate]);

  useEffect(() => {
    if (
      selectedKind !== "video" ||
      !session?.id ||
      selectedNode?.type !== "file"
    ) {
      setVideoQualityOptions([]);
      setSelectedVideoQuality("source");
      return;
    }

    let cancelled = false;
    const path = selectedNode.path;

    async function loadQualityOptions() {
      try {
        const query = new URLSearchParams({ path });
        const response = await fetch(
          `/api/sessions/${session.id}/video/qualities?${query.toString()}`,
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Could not load video qualities.");
        }

        const options = Array.isArray(payload.options)
          ? payload.options.map((option) => ({
              id: String(option.id),
              label: String(option.label || option.id),
            }))
          : [];
        const selected =
          options.find((item) => item.id === payload.defaultQuality)?.id ||
          options.find((item) => item.id === "source")?.id ||
          options[0]?.id ||
          "source";

        if (!cancelled) {
          setVideoQualityOptions(options);
          setSelectedVideoQuality(selected);
        }
      } catch {
        if (!cancelled) {
          setVideoQualityOptions([{ id: "source", label: "Original" }]);
          setSelectedVideoQuality("source");
        }
      }
    }

    loadQualityOptions();
    return () => {
      cancelled = true;
    };
  }, [selectedKind, selectedNode, session]);

  useEffect(() => {
    latestJobIdRef.current = activeJob?.id || "";
  }, [activeJob]);

  useEffect(() => {
    return () => {
      closeJobEvents();
      stopJobPolling();
      clearImagePreviewCache();
      textPreviewCacheRef.current.clear();
      if (latestSessionIdRef.current) {
        fetch(`/api/sessions/${latestSessionIdRef.current}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
      }
      if (latestJobIdRef.current) {
        fetch(`/api/session-jobs/${latestJobIdRef.current}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      const activeElement = document.activeElement;
      const activeTag = activeElement?.tagName;
      if (
        activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        activeTag === "SELECT" ||
        activeElement?.closest?.(".custom-dropdown-shell")
      ) {
        return;
      }

      if (selectedKind === "video" && videoPlayerRef.current) {
        const player = videoPlayerRef.current;
        const step = Math.max(1, Number(keyboardSettings.jumpSeconds) || 5);
        const rateStep = Math.max(
          0.05,
          Number(keyboardSettings.rateStep) || 0.25,
        );

        if (event.key === "ArrowRight") {
          event.preventDefault();
          player.currentTime(Math.max(0, (player.currentTime() || 0) + step));
          return;
        }

        if (event.key === "ArrowLeft") {
          event.preventDefault();
          player.currentTime(Math.max(0, (player.currentTime() || 0) - step));
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          const nextVolume = Math.min(1, (player.volume() || 0) + 0.05);
          player.volume(nextVolume);
          setVideoVolume(nextVolume);
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextVolume = Math.max(0, (player.volume() || 0) - 0.05);
          player.volume(nextVolume);
          setVideoVolume(nextVolume);
          return;
        }

        if (event.key === "]") {
          event.preventDefault();
          const nextRate = Math.min(3, (player.playbackRate() || 1) + rateStep);
          player.playbackRate(nextRate);
          setVideoPlaybackRate(nextRate);
          return;
        }

        if (event.key === "[") {
          event.preventDefault();
          const nextRate = Math.max(
            0.25,
            (player.playbackRate() || 1) - rateStep,
          );
          player.playbackRate(nextRate);
          setVideoPlaybackRate(nextRate);
          return;
        }
      }

      if (currentImageIndex === -1) {
        if (event.key === "Escape") {
          setSlideshowOpen(false);
        }
        return;
      }

      if (event.key === "ArrowRight") {
        const nextPath = nextImagePath;
        if (nextPath) {
          event.preventDefault();
          setSelectedPath(nextPath);
        }
      }

      if (event.key === "ArrowLeft") {
        const prevPath = previousImagePath;
        if (prevPath) {
          event.preventDefault();
          setSelectedPath(prevPath);
        }
      }

      if (slideshowOpen && event.key === "Home" && currentFolderImages[0]) {
        event.preventDefault();
        setSelectedPath(currentFolderImages[0]);
      }

      if (
        slideshowOpen &&
        event.key === "End" &&
        currentFolderImages[currentFolderImages.length - 1]
      ) {
        event.preventDefault();
        setSelectedPath(currentFolderImages[currentFolderImages.length - 1]);
      }

      if (
        !slideshowOpen &&
        selectedKind === "image" &&
        (event.key === "Enter" || event.key.toLowerCase() === "f")
      ) {
        event.preventDefault();
        setSlideshowOpen(true);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setSlideshowOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentFolderImages,
    currentImageIndex,
    nextImagePath,
    previousImagePath,
    keyboardSettings,
    selectedKind,
    slideshowOpen,
  ]);

  useEffect(() => {
    if (!session || selectedKind !== "image" || currentImageIndex === -1) {
      return;
    }

    const preloadTargets = [
      currentFolderImages[currentImageIndex + 1] || currentFolderImages[0],
      currentFolderImages[currentImageIndex - 1] ||
        currentFolderImages[currentFolderImages.length - 1],
      currentFolderImages[currentImageIndex + 2] || "",
    ].filter(Boolean);

    const preloaders = preloadTargets.map((imagePath) => {
      loadImagePreview(imagePath, previewQuality).catch(() => "");
      return imagePath;
    });

    return () => {
      preloaders.forEach(() => {});
    };
  }, [
    currentFolderImages,
    currentImageIndex,
    previewQuality,
    selectedKind,
    session,
  ]);

  useEffect(() => {
    if (!slideshowOpen) {
      setSlideshowChromeHidden(false);
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [slideshowOpen]);

  const slideshowModal =
    slideshowOpen && selectedKind === "image" && selectedNode
      ? createPortal(
          <div
            className={`slideshow-overlay ${slideshowChromeHidden ? "chrome-hidden" : ""}`}
          >
            <div
              className="slideshow-viewport"
              role="dialog"
              aria-modal="true"
              aria-label={`Slideshow for ${selectedNode.name}`}
            >
              <div
                className={`slideshow-stage slideshow-fit-${slideshowFitMode}`}
                onDoubleClick={() =>
                  setSlideshowChromeHidden((current) => !current)
                }
              >
                <img
                  src={selectedImageSrc || selectedImagePreviewUrl}
                  alt={selectedNode.name}
                />
              </div>

              <div className="slideshow-floating slideshow-floating-top">
                <div className="slideshow-info-card">
                  <div className="panel-title-group">
                    <p className="panel-label">Folder slideshow</p>
                    <h2 title={selectedNode.name}>{selectedNode.name}</h2>
                    <div className="slideshow-meta">
                      <span>
                        {currentImageIndex + 1} / {currentFolderImages.length}
                      </span>
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
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setSelectedPath(currentFolderImages[0])}
                    >
                      First
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        setSelectedPath(
                          currentFolderImages[currentFolderImages.length - 1],
                        )
                      }
                    >
                      Last
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setSlideshowChromeHidden(true)}
                    >
                      Hide UI
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setSlideshowOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>

              <div
                className="slideshow-floating slideshow-floating-nav"
                aria-hidden={slideshowChromeHidden}
              >
                <button
                  className="nav-button nav-button-left"
                  type="button"
                  aria-label="Previous image"
                  onClick={() => setSelectedPath(previousImagePath)}
                >
                  {"<"}
                </button>
                <button
                  className="nav-button nav-button-right"
                  type="button"
                  aria-label="Next image"
                  onClick={() => setSelectedPath(nextImagePath)}
                >
                  {">"}
                </button>
              </div>

              <div className="slideshow-floating slideshow-floating-bottom">
                <div className="slideshow-neighbors-card">
                  <div className="slideshow-neighbors">
                    <span>Prev: {previousImageName || "None"}</span>
                    <span>Next: {nextImageName || "None"}</span>
                  </div>
                  <div className="navigation-hint">
                    Arrow keys move, Home/End jump, F opens slideshow, Escape
                    closes it, and double-click toggles the overlay.
                  </div>
                </div>
              </div>

              {slideshowChromeHidden ? (
                <button
                  className="slideshow-reveal-button"
                  type="button"
                  onClick={() => setSlideshowChromeHidden(false)}
                >
                  Show UI
                </button>
              ) : null}
            </div>
          </div>,
          document.body,
        )
      : null;

  const explorerModal =
    explorerModalOpen && sortedTree
      ? createPortal(
          <div className="settings-overlay" role="dialog" aria-modal="true">
            <div className="settings-sheet explorer-modal-sheet">
              <div className="panel-header">
                <div className="panel-title-group">
                  <p className="panel-label">Explorer modal</p>
                  <h2 title={sortedTree.name}>{sortedTree.name}</h2>
                </div>
                <button
                  className="ghost-button compact-button"
                  type="button"
                  onClick={() => setExplorerModalOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="explorer-modal-body">
                <TreeExplorer
                  rootNode={sortedTree}
                  selectedPath={selectedPath}
                  onSelect={(node) => {
                    if (node.type === "file") {
                      setSelectedPath(node.path);
                      setExplorerModalOpen(false);
                    }
                  }}
                />
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  const visualDownloadedBytes = Math.max(
    0,
    Number(activeJob?.downloadedBytes) || 0,
  );
  const transcodeCompleted = Math.max(
    0,
    Number(activeJob?.transcodedEntries) || 0,
  );
  const transcodeTotal = Math.max(
    0,
    Number(activeJob?.totalTranscodeEntries) || 0,
  );
  const visualPercent =
    activeJob?.phase === "transcoding" &&
    activeJob?.percent == null &&
    transcodeTotal > 0
      ? (transcodeCompleted / transcodeTotal) * 100
      : activeJob?.percent;
  const visualPercentLabel =
    visualPercent == null
      ? "Live"
      : `${Math.max(0, Math.min(100, Math.floor(visualPercent)))}%`;
  const visualProgressWidth =
    visualPercent == null
      ? undefined
      : `${Math.max(0, Math.min(100, visualPercent))}%`;
  const transferLabel =
    activeJob?.phase === "transcoding"
      ? `${transcodeCompleted} / ${Math.max(1, transcodeTotal)} files`
      : activeJob?.reportedSize > 0
        ? `${formatTransferBytes(visualDownloadedBytes)} / ${formatTransferBytes(activeJob.reportedSize)}`
        : `${formatTransferBytes(visualDownloadedBytes)} downloaded`;
  const speedLabel = formatSpeed(
    activeJob?.downloadSpeedBytesPerSec || activeJob?.averageSpeedBytesPerSec,
  );
  const etaLabel = formatEta(activeJob?.etaSeconds);
  const modeLabel =
    activeJob?.threadMode === "segmented"
      ? "Segmented"
      : activeJob?.threadMode === "single"
        ? "Single"
        : "Auto";
  const threadLabel = `${activeJob?.threadCount || 1}`;
  const retryLabel = `${activeJob?.retryCount || 0} / ${activeJob?.maxRetries === -1 ? "∞" : (activeJob?.maxRetries ?? 0)}`;

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-one" />
      <div className="backdrop backdrop-two" />

      <main className="workspace">
        <WorkspaceTabs
          tabs={WORKSPACE_TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {activeTab === "download" ? (
          <section className="hero-panel">
            <div className="hero-topbar">
              <div>
                <p className="eyebrow">ZIP image and file explorer</p>
                <h1>Archive Atlas</h1>
                <p className="hero-copy">
                  Paste a public ZIP URL, let the server unpack it, then browse
                  the folder structure with a fast viewer and image-first
                  navigation.
                </p>
              </div>
              <button
                className="ghost-button theme-toggle"
                type="button"
                onClick={() =>
                  setTheme((current) => (current === "dark" ? "light" : "dark"))
                }
              >
                {theme === "dark" ? "Switch to light" : "Switch to dark"}
              </button>
            </div>

            <form className="url-form" onSubmit={handleSubmit}>
              <label className="input-shell" htmlFor="zip-url">
                <span className="input-label">Public ZIP URL</span>
                <input
                  id="zip-url"
                  type="url"
                  placeholder="https://example.com/file-or-archive"
                  value={zipUrl}
                  onChange={(event) => setZipUrl(event.target.value)}
                  autoComplete="off"
                />
              </label>

              <button
                className="primary-button"
                type="submit"
                disabled={isLoading}
              >
                {activeJob
                  ? "Loading file..."
                  : isLoading
                    ? "Opening file..."
                    : "Open file"}
              </button>
            </form>

            <div className="message-card">
              Download tuning, explorer columns, sorting defaults, and keyboard
              shortcuts are now configured from the Global settings sheet.
            </div>

            {activeJob ? (
              <div className="progress-card" aria-live="polite">
                <div className="progress-card-head">
                  <strong>
                    {activeJob.phase === "transcoding"
                      ? `Transcoding (${activeJob.videoQuality || downloadSettings.videoQuality})`
                      : activeJob.phase === "extracting"
                        ? "Preparing archive"
                        : "Downloading archive"}
                  </strong>
                  <span>{visualPercentLabel}</span>
                </div>
                <div
                  className={`progress-bar-shell ${visualPercent == null ? "indeterminate" : ""}`}
                >
                  <div
                    className="progress-bar-fill"
                    style={
                      visualPercent == null
                        ? undefined
                        : { width: visualProgressWidth }
                    }
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
                  <div className="progress-stat-cell">
                    <span className="progress-stat-label">ETA</span>
                    <strong>{etaLabel}</strong>
                  </div>
                  <div className="progress-stat-cell">
                    <span className="progress-stat-label">Mode</span>
                    <strong>{`${modeLabel} (${threadLabel}x)`}</strong>
                  </div>
                  <div className="progress-stat-cell">
                    <span className="progress-stat-label">Retries</span>
                    <strong>{retryLabel}</strong>
                  </div>
                  <div className="progress-stat-cell">
                    <span className="progress-stat-label">Status</span>
                    <strong>
                      {activeJob?.isStalled
                        ? "Stalled"
                        : activeJob?.phase === "transcoding"
                          ? "Transcoding"
                          : activeJob?.phase === "extracting"
                            ? "Extracting"
                            : "Downloading"}
                    </strong>
                  </div>
                </div>
                <div className="progress-meta-row">
                  <span>{formatProgressMessage(activeJob)}</span>
                  <button
                    className="ghost-button compact-button"
                    type="button"
                    onClick={() => clearArchive(true)}
                  >
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
                <button
                  className="ghost-button compact-button"
                  type="button"
                  onClick={() => clearArchive(true)}
                >
                  Clear opened archive
                </button>
              ) : null}
            </div>

            {error ? <div className="message-card error">{error}</div> : null}
            {oversizePrompt ? (
              <div className="message-card warning">
                <div>
                  This archive reports{" "}
                  {formatBytes(oversizePrompt.reportedSize)}. Continue
                  downloading anyway?
                </div>
                <div className="message-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setOversizePrompt(null)}
                  >
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
                      await fetch(
                        `/api/session-jobs/${oversizePrompt.jobId}/confirm`,
                        { method: "POST" },
                      ).catch(() => {});
                    }}
                  >
                    Proceed download
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "preview" ? (
          <section className="viewer-grid">
            <aside className="sidebar-panel">
              <div className="panel-header panel-header-stackable explorer-header">
                <div className="panel-title-group explorer-title-group">
                  <p className="panel-label">Explorer</p>
                  <h2 title={sortedTree?.name || "No archive loaded"}>
                    {sortedTree?.name || "No archive loaded"}
                  </h2>
                </div>
                <div className="sidebar-header-actions">
                  {session ? (
                    <span className="panel-chip">
                      {session.stats.fileCount} files
                    </span>
                  ) : null}
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
                {sortMode === "natural-tail"
                  ? "Number trail mode keeps names like file 2, file 10, file 11 in number order."
                  : sortMode.startsWith("date")
                    ? "Date sorting uses ZIP entry modified times when the archive provides them."
                    : "Sorting affects explorer order, preview arrows, thumbnails, and slideshow navigation."}
              </div>

              <div className="tree-scroll">
                {sortedTree ? (
                  <TreeExplorer
                    rootNode={sortedTree}
                    selectedPath={selectedPath}
                    onSelect={(node) => {
                      if (node.type === "file") {
                        setSelectedPath(node.path);
                      }
                    }}
                  />
                ) : (
                  <div className="empty-card">
                    <strong>Ready to unpack</strong>
                    <p>
                      Load a ZIP URL to inspect folders, preview images, and
                      move across image sets with arrow keys.
                    </p>
                  </div>
                )}
              </div>
            </aside>

            <section className="preview-panel">
              <div className="panel-header">
                <div className="panel-title-group">
                  <p className="panel-label">Preview</p>
                  <h2 title={selectedNode?.name || "Select a file"}>
                    {selectedNode?.name || "Select a file"}
                  </h2>
                </div>
                {selectedNode?.type === "file" ? (
                  <div className="panel-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setExplorerModalOpen(true)}
                    >
                      Open explorer
                    </button>
                    {selectedKind === "image" ? (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => setSlideshowOpen(true)}
                      >
                        Slideshow
                      </button>
                    ) : null}
                    <a
                      className="ghost-button inline-link"
                      href={selectedFileUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open raw
                    </a>
                  </div>
                ) : null}
              </div>

              {!selectedNode || selectedNode.type !== "file" ? (
                <div className="empty-card preview-empty">
                  <strong>Nothing selected</strong>
                  <p>
                    Choose a file from the sidebar to start previewing its
                    contents.
                  </p>
                </div>
              ) : null}

              {selectedNode?.type === "file" && selectedKind === "image" ? (
                <div className="preview-stage">
                  <div className="preview-toolbar">
                    <span>{formatBytes(selectedNode.size)}</span>
                    <span>
                      {currentImageIndex >= 0
                        ? `${currentImageIndex + 1} / ${currentFolderImages.length} in folder`
                        : "Single image"}
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
                    <img
                      src={selectedImageSrc || selectedImagePreviewUrl}
                      alt={selectedNode.name}
                    />
                  </div>
                  {currentFolderImageItems.length > 1 ? (
                    <div
                      className={`thumbnail-strip-shell ${thumbnailStripExpanded ? "expanded" : "collapsed"}`}
                    >
                      <div className="thumbnail-strip-header">
                        <div>
                          <strong>Folder thumbnails</strong>
                          <div className="thumbnail-strip-copy">
                            {thumbnailStripExpanded
                              ? `Showing all ${currentFolderImageItems.length} sibling images.`
                              : "Showing nearby images around the current selection."}
                          </div>
                        </div>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() =>
                            setThumbnailStripExpanded((current) => !current)
                          }
                        >
                          {thumbnailStripExpanded
                            ? "Collapse strip"
                            : "Expand strip"}
                        </button>
                      </div>
                      <div
                        className={`thumbnail-strip ${thumbnailStripExpanded ? "expanded" : "collapsed"}`}
                        role="list"
                        aria-label="Folder images"
                      >
                        {visibleThumbnailItems.map((item) => (
                          <button
                            key={item.path}
                            type="button"
                            className={`thumbnail-card ${item.path === selectedPath ? "active" : ""}`}
                            onClick={() => setSelectedPath(item.path)}
                          >
                            <img
                              src={item.thumbnailUrl}
                              alt={item.name}
                              loading="lazy"
                            />
                            <span>{item.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="navigation-hint">
                    Use left and right arrow keys to move through sibling images
                    in the active sort order.
                  </div>
                </div>
              ) : null}

              {selectedNode?.type === "file" && selectedKind === "text" ? (
                <div className="text-preview">
                  <div className="preview-toolbar">
                    <span>{formatBytes(selectedNode.size)}</span>
                    <span>{selectedNode.extension.toUpperCase()} preview</span>
                    <span>{formatDate(selectedNode.modifiedAt)}</span>
                  </div>
                  <pre>{textPreview || "Loading file..."}</pre>
                </div>
              ) : null}

              {selectedNode?.type === "file" && selectedKind === "video" ? (
                <div className="preview-stage">
                  <div className="preview-toolbar">
                    <span>{formatBytes(selectedNode.size)}</span>
                    <span>
                      {selectedNode.extension.toUpperCase()} stream preview
                    </span>
                    <CustomDropdown
                      id="video-quality"
                      label="Quality"
                      value={selectedVideoQuality}
                      options={
                        videoQualityOptions.length
                          ? videoQualityOptions.map((item) => ({
                              value: item.id,
                              label: item.label,
                            }))
                          : [{ value: "source", label: "Original" }]
                      }
                      onChange={setSelectedVideoQuality}
                    />
                    <span>{formatDate(selectedNode.modifiedAt)}</span>
                  </div>
                  <div className="image-frame media-frame" ref={videoShellRef}>
                    <video
                      ref={videoRef}
                      className="video-player"
                      controls
                      playsInline
                      preload="metadata"
                    >
                      Your browser cannot play this video inline.
                    </video>
                  </div>
                  <div className="progress-meta-row">
                    <span>
                      Jump: {keyboardSettings.jumpSeconds}s | Rate step:{" "}
                      {keyboardSettings.rateStep}x
                    </span>
                    <span>
                      {activeJob?.phase === "transcoding"
                        ? `Transcoding ${activeJob.videoQuality || selectedVideoQuality}: ${activeJob.transcodedEntries || 0}/${activeJob.totalTranscodeEntries || 0}`
                        : `Playing ${selectedVideoQuality} quality`}
                    </span>
                    <div className="message-actions">
                      <button
                        className="ghost-button compact-button"
                        type="button"
                        onClick={() => {
                          if (!videoPlayerRef.current) return;
                          const nextRate = Math.max(
                            0.25,
                            videoPlayerRef.current.playbackRate() -
                              keyboardSettings.rateStep,
                          );
                          videoPlayerRef.current.playbackRate(nextRate);
                          setVideoPlaybackRate(nextRate);
                        }}
                      >
                        Slower
                      </button>
                      <button
                        className="ghost-button compact-button"
                        type="button"
                        onClick={() => {
                          if (!videoPlayerRef.current) return;
                          const nextRate = Math.min(
                            3,
                            videoPlayerRef.current.playbackRate() +
                              keyboardSettings.rateStep,
                          );
                          videoPlayerRef.current.playbackRate(nextRate);
                          setVideoPlaybackRate(nextRate);
                        }}
                      >
                        Faster
                      </button>
                    </div>
                  </div>
                  <div className="navigation-hint">
                    Arrow left and right seek by {keyboardSettings.jumpSeconds}
                    s, arrow up and down changes volume, and [ ] changes speed.
                  </div>
                </div>
              ) : null}

              {selectedNode?.type === "file" && selectedKind === "audio" ? (
                <div className="preview-stage">
                  <div className="preview-toolbar">
                    <span>{formatBytes(selectedNode.size)}</span>
                    <span>
                      {selectedNode.extension.toUpperCase()} stream preview
                    </span>
                    <span>{formatDate(selectedNode.modifiedAt)}</span>
                  </div>
                  <div className="image-frame media-frame">
                    <audio
                      className="video-player"
                      src={selectedFileUrl}
                      controls
                      preload="metadata"
                    >
                      Your browser cannot play this audio inline.
                    </audio>
                  </div>
                </div>
              ) : null}

              {selectedNode?.type === "file" && selectedKind === "binary" ? (
                <div className="empty-card preview-empty">
                  <strong>Binary file</strong>
                  <p>
                    This file type does not have an inline preview yet. Open the
                    raw file in a new tab or download it.
                  </p>
                </div>
              ) : null}
            </section>
          </section>
        ) : null}

        {activeTab === "explorer" ? (
          <ExplorerTablePanel
            sortedTree={sortedTree}
            session={session}
            explorerRows={explorerRows}
            selectedPath={selectedPath}
            setSelectedPath={setSelectedPath}
            sortMode={sortMode}
            setSortMode={setSortMode}
            sortOptions={SORT_OPTIONS}
            explorerColumns={explorerColumns}
            formatDate={formatDate}
            formatBytes={formatBytes}
            DropdownComponent={CustomDropdown}
          />
        ) : null}
      </main>
      <GlobalSettingsSheet
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        downloadSettings={downloadSettings}
        setDownloadSettings={(updater) => {
          setDownloadOptions((current) => {
            const legacyCurrent = downloadOptionsToLegacySettings(current);
            const legacyNext =
              typeof updater === "function" ? updater(legacyCurrent) : updater;
            return normalizeDownloadOptions(legacyNext);
          });
        }}
        normalizeDownloadSettings={normalizeDownloadSettings}
        sortMode={sortMode}
        setSortMode={setSortMode}
        sortOptions={SORT_OPTIONS}
        previewQuality={previewQuality}
        setPreviewQuality={setPreviewQuality}
        previewQualityOptions={PREVIEW_QUALITY_OPTIONS}
        videoTranscodeQuality={downloadSettings.videoQuality}
        setVideoTranscodeQuality={(value) =>
          setDownloadOptions((current) =>
            normalizeDownloadOptions({
              ...current,
              media: {
                ...current.media,
                videoQuality: value,
              },
            }),
          )
        }
        videoTranscodeQualityOptions={VIDEO_TRANSCODE_QUALITY_OPTIONS}
        keyboardSettings={keyboardSettings}
        setKeyboardSettings={setKeyboardSettings}
        explorerColumns={explorerColumns}
        setExplorerColumns={setExplorerColumns}
        downloadThreadModeOptions={DOWNLOAD_THREAD_MODE_OPTIONS}
        downloadRetryOptions={DOWNLOAD_RETRY_OPTIONS}
        clampNumber={clampNumber}
        DropdownComponent={CustomDropdown}
      />
      {slideshowModal}
      {explorerModal}
    </div>
  );
}

export default App;
