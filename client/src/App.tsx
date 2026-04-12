import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import { CustomDropdown } from "./components/Common/CustomDropdown";
import { openJobSocket } from "./lib/jobSocket";
import { classifyNodeKind, getVideoMimeType } from "./lib/mimeTypeSystem";
import {
  DOWNLOAD_RETRY_OPTIONS,
  DOWNLOAD_THREAD_MODE_OPTIONS,
  PREVIEW_QUALITY_OPTIONS,
  SLIDESHOW_FIT_OPTIONS,
  SORT_OPTIONS,
  STRIP_THUMB_SIZE,
  VIDEO_TRANSCODE_QUALITY_OPTIONS,
  WORKSPACE_TABS,
  DEFAULT_DOWNLOAD_OPTIONS,
} from "./lib/appConstants";
import {
  getImageCacheKey,
  getThumbnailWindow,
  getWrappedPath,
  isTerminalJobStatus,
  formatProgressMessage,
  wait,
} from "./lib/archiveUiUtils";
import {
  clampNumber,
  downloadOptionsToLegacySettings,
  normalizeDownloadOptions,
  normalizeDownloadSettings,
} from "./lib/downloadOptions";
import { buildFileUrl } from "./lib/fileUrl";
import {
  formatBytes,
  formatDate,
  formatEta,
  formatMediaTime,
  formatSpeed,
  formatTransferBytes,
} from "./lib/formatterUtils";
import {
  cloneAndSortTree,
  compareNodes,
  flattenTree,
  getFirstFilePath,
} from "./lib/treeUtils";
import { fetchJson } from "./services/apiClient";
import type { DownloadOptions } from "./types/download";
import { WorkspaceTabs, type WorkspaceTabId } from "./components/WorkspaceTabs";
import { ExplorerTablePanel } from "./components/ExplorerTablePanel";
import { GlobalSettingsSheet } from "./components/GlobalSettingsSheet";
import { TreeExplorer } from "./components/TreeExplorer";

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
  const [videoPlaybackError, setVideoPlaybackError] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoBufferedEnd, setVideoBufferedEnd] = useState(0);
  const [videoIsPlaying, setVideoIsPlaying] = useState(false);
  const [videoIsFullscreen, setVideoIsFullscreen] = useState(false);
  const [videoSeekHoverTime, setVideoSeekHoverTime] = useState<number | null>(
    null,
  );
  const [videoSeekPreviewUrl, setVideoSeekPreviewUrl] = useState("");
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
  const hlsRef = useRef<Hls | null>(null);
  const seekDebounceRef = useRef<number | null>(null);
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
  const selectedKind = classifyNodeKind(selectedNode);
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
  const selectedVideoOriginalUrl =
    selectedNode?.type === "file" && selectedKind === "video"
      ? `/api/sessions/${session?.id}/video/play?${new URLSearchParams({
          path: selectedNode.path,
          quality: "source",
        }).toString()}`
      : "";
  const selectedVideoHlsUrl =
    selectedNode?.type === "file" && selectedKind === "video"
      ? `/api/sessions/${session?.id}/video/hls/playlist?${new URLSearchParams({
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
    const videoElement = videoRef.current;
    if (!videoElement || selectedKind !== "video") {
      return;
    }

    function syncState() {
      setVideoDuration(Number(videoElement.duration) || 0);
      setVideoCurrentTime(Number(videoElement.currentTime) || 0);

      const buffered = videoElement.buffered;
      if (buffered.length > 0) {
        setVideoBufferedEnd(buffered.end(buffered.length - 1));
      } else {
        setVideoBufferedEnd(0);
      }
    }

    function onPlay() {
      setVideoIsPlaying(true);
    }

    function onPause() {
      setVideoIsPlaying(false);
    }

    function onError() {
      const mediaError = videoElement.error;
      const detail =
        mediaError?.message ||
        (mediaError?.code
          ? `Playback failed (code ${mediaError.code}).`
          : "Playback failed.");
      setVideoPlaybackError(detail);
    }

    videoElement.addEventListener("timeupdate", syncState);
    videoElement.addEventListener("progress", syncState);
    videoElement.addEventListener("loadedmetadata", syncState);
    videoElement.addEventListener("play", onPlay);
    videoElement.addEventListener("pause", onPause);
    videoElement.addEventListener("error", onError);
    syncState();

    return () => {
      videoElement.removeEventListener("timeupdate", syncState);
      videoElement.removeEventListener("progress", syncState);
      videoElement.removeEventListener("loadedmetadata", syncState);
      videoElement.removeEventListener("play", onPlay);
      videoElement.removeEventListener("pause", onPause);
      videoElement.removeEventListener("error", onError);
    };
  }, [selectedKind]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || selectedKind !== "video" || !selectedNode) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }

    const useOriginal = selectedVideoQuality === "source";
    setVideoPlaybackError("");

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (!useOriginal && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: false,
        maxBufferLength: 30,
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          setVideoPlaybackError(data?.details || "HLS playback failed.");
        }
      });
      hls.loadSource(selectedVideoHlsUrl);
      hls.attachMedia(videoElement);
    } else if (
      !useOriginal &&
      videoElement.canPlayType("application/vnd.apple.mpegurl")
    ) {
      videoElement.src = selectedVideoHlsUrl;
      videoElement.load();
    } else {
      videoElement.innerHTML = "";
      const source = document.createElement("source");
      source.src = selectedVideoOriginalUrl;
      source.type = getVideoMimeType(selectedNode.extension);
      videoElement.appendChild(source);
      videoElement.load();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [
    selectedKind,
    selectedNode,
    selectedVideoHlsUrl,
    selectedVideoOriginalUrl,
    selectedVideoQuality,
  ]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || selectedKind !== "video") {
      return;
    }

    if (Math.abs((videoElement.volume || 0) - videoVolume) > 0.01) {
      videoElement.volume = videoVolume;
    }
  }, [selectedKind, videoVolume]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || selectedKind !== "video") {
      return;
    }

    if (Math.abs((videoElement.playbackRate || 1) - videoPlaybackRate) > 0.01) {
      videoElement.playbackRate = videoPlaybackRate;
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
        const payload = await fetchJson<{
          options?: Array<{ id?: string; label?: string }>;
          defaultQuality?: string;
        }>(`/api/sessions/${session.id}/video/qualities?${query.toString()}`);

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

      if (selectedKind === "video" && videoRef.current) {
        const player = videoRef.current;
        const step = Math.max(1, Number(keyboardSettings.jumpSeconds) || 5);
        const rateStep = Math.max(
          0.05,
          Number(keyboardSettings.rateStep) || 0.25,
        );

        if (event.key === "ArrowRight") {
          event.preventDefault();
          player.currentTime = Math.max(0, (player.currentTime || 0) + step);
          return;
        }

        if (event.key === "ArrowLeft") {
          event.preventDefault();
          player.currentTime = Math.max(0, (player.currentTime || 0) - step);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          const nextVolume = Math.min(1, (player.volume || 0) + 0.05);
          player.volume = nextVolume;
          setVideoVolume(nextVolume);
          return;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextVolume = Math.max(0, (player.volume || 0) - 0.05);
          player.volume = nextVolume;
          setVideoVolume(nextVolume);
          return;
        }

        if (event.key === "]") {
          event.preventDefault();
          const nextRate = Math.min(3, (player.playbackRate || 1) + rateStep);
          player.playbackRate = nextRate;
          setVideoPlaybackRate(nextRate);
          return;
        }

        if (event.key === "[") {
          event.preventDefault();
          const nextRate = Math.max(
            0.25,
            (player.playbackRate || 1) - rateStep,
          );
          player.playbackRate = nextRate;
          setVideoPlaybackRate(nextRate);
          return;
        }

        if (event.key.toLowerCase() === "f") {
          event.preventDefault();
          const shell = videoShellRef.current;
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            shell?.requestFullscreen?.().catch(() => {});
          }
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

  useEffect(() => {
    function onFullscreenChange() {
      const shell = videoShellRef.current;
      setVideoIsFullscreen(
        Boolean(shell && document.fullscreenElement === shell),
      );
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (
      selectedKind !== "video" ||
      selectedNode?.type !== "file" ||
      !session?.id ||
      videoSeekHoverTime == null
    ) {
      setVideoSeekPreviewUrl("");
      return;
    }

    if (seekDebounceRef.current) {
      window.clearTimeout(seekDebounceRef.current);
    }

    seekDebounceRef.current = window.setTimeout(() => {
      const query = new URLSearchParams({
        path: selectedNode.path,
        quality: selectedVideoQuality,
        time: String(videoSeekHoverTime),
        width: "260",
      });
      const url = `/api/sessions/${session.id}/video/thumbnail?${query.toString()}`;
      setVideoSeekPreviewUrl(url);
    }, 140);

    return () => {
      if (seekDebounceRef.current) {
        window.clearTimeout(seekDebounceRef.current);
      }
    };
  }, [
    session,
    selectedKind,
    selectedNode,
    selectedVideoQuality,
    videoSeekHoverTime,
  ]);

  const videoPlayedPercent =
    videoDuration > 0
      ? Math.max(0, Math.min(100, (videoCurrentTime / videoDuration) * 100))
      : 0;
  const videoBufferedPercent =
    videoDuration > 0
      ? Math.max(0, Math.min(100, (videoBufferedEnd / videoDuration) * 100))
      : 0;

  function toggleVideoPlayback() {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    if (videoElement.paused) {
      videoElement.play().catch(() => {});
    } else {
      videoElement.pause();
    }
  }

  function seekVideoTo(timeSeconds: number) {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const bounded = Math.max(0, Math.min(videoDuration || 0, timeSeconds));

    if (selectedVideoQuality !== "source") {
      const hlsUrl = new URL(selectedVideoHlsUrl, window.location.origin);
      hlsUrl.searchParams.set("seekSeconds", String(bounded));

      if (hlsRef.current) {
        hlsRef.current.loadSource(hlsUrl.pathname + hlsUrl.search);
      } else if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
        videoElement.src = hlsUrl.pathname + hlsUrl.search;
        videoElement.load();
      }
    }

    videoElement.currentTime = bounded;
    setVideoCurrentTime(bounded);
  }

  function toggleVideoFullscreen() {
    const shell = videoShellRef.current;
    if (!shell) {
      return;
    }

    if (document.fullscreenElement === shell) {
      document.exitFullscreen().catch(() => {});
      return;
    }

    shell.requestFullscreen?.().catch(() => {});
  }

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
                    onChange={(value) => setSlideshowFitMode(String(value))}
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
                  onChange={(value) => setSortMode(String(value))}
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
                      onChange={(value) => setPreviewQuality(String(value))}
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
                      onChange={(value) =>
                        setSelectedVideoQuality(String(value))
                      }
                    />
                    <span>{formatDate(selectedNode.modifiedAt)}</span>
                  </div>
                  <div className="image-frame media-frame" ref={videoShellRef}>
                    <video
                      ref={videoRef}
                      className="video-player"
                      playsInline
                      preload="metadata"
                    >
                      Your browser cannot play this video inline.
                    </video>
                    <div className="custom-video-controls">
                      <button
                        className="ghost-button compact-button"
                        type="button"
                        onClick={toggleVideoPlayback}
                      >
                        {videoIsPlaying ? "Pause" : "Play"}
                      </button>
                      <span className="video-time-label">
                        {formatMediaTime(videoCurrentTime)} /{" "}
                        {formatMediaTime(videoDuration)}
                      </span>
                      <div
                        className="video-progress-shell"
                        onMouseLeave={() => setVideoSeekHoverTime(null)}
                      >
                        <div className="video-buffer-track">
                          <span
                            className="video-buffer-value"
                            style={{ width: `${videoBufferedPercent}%` }}
                          />
                          <span
                            className="video-played-value"
                            style={{ width: `${videoPlayedPercent}%` }}
                          />
                        </div>
                        <input
                          className="video-progress-range"
                          type="range"
                          min={0}
                          max={Math.max(1, videoDuration)}
                          step={0.05}
                          value={Math.min(
                            videoCurrentTime,
                            Math.max(1, videoDuration),
                          )}
                          onChange={(event) =>
                            seekVideoTo(Number(event.currentTarget.value) || 0)
                          }
                          onMouseMove={(event) => {
                            const rect =
                              event.currentTarget.getBoundingClientRect();
                            const ratio = Math.max(
                              0,
                              Math.min(
                                1,
                                (event.clientX - rect.left) /
                                  Math.max(1, rect.width),
                              ),
                            );
                            setVideoSeekHoverTime((videoDuration || 0) * ratio);
                          }}
                        />
                        {videoSeekHoverTime != null && videoSeekPreviewUrl ? (
                          <div className="video-seek-preview">
                            <img src={videoSeekPreviewUrl} alt="Seek preview" />
                            <span>{formatMediaTime(videoSeekHoverTime)}</span>
                          </div>
                        ) : null}
                      </div>
                      <label className="video-volume-shell">
                        Vol
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={videoVolume}
                          onChange={(event) =>
                            setVideoVolume(
                              Number(event.currentTarget.value) || 0,
                            )
                          }
                        />
                      </label>
                      <label className="video-volume-shell">
                        Speed
                        <input
                          type="range"
                          min={0.25}
                          max={3}
                          step={0.05}
                          value={videoPlaybackRate}
                          onChange={(event) =>
                            setVideoPlaybackRate(
                              Math.max(
                                0.25,
                                Math.min(
                                  3,
                                  Number(event.currentTarget.value) || 1,
                                ),
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        className="ghost-button compact-button"
                        type="button"
                        onClick={toggleVideoFullscreen}
                      >
                        {videoIsFullscreen ? "Exit Full" : "Full"}
                      </button>
                    </div>
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
                          if (!videoRef.current) return;
                          const nextRate = Math.max(
                            0.25,
                            videoRef.current.playbackRate -
                              keyboardSettings.rateStep,
                          );
                          videoRef.current.playbackRate = nextRate;
                          setVideoPlaybackRate(nextRate);
                        }}
                      >
                        Slower
                      </button>
                      <button
                        className="ghost-button compact-button"
                        type="button"
                        onClick={() => {
                          if (!videoRef.current) return;
                          const nextRate = Math.min(
                            3,
                            videoRef.current.playbackRate +
                              keyboardSettings.rateStep,
                          );
                          videoRef.current.playbackRate = nextRate;
                          setVideoPlaybackRate(nextRate);
                        }}
                      >
                        Faster
                      </button>
                    </div>
                  </div>
                  <div className="navigation-hint">
                    Arrow left and right seek by {keyboardSettings.jumpSeconds}
                    s, arrow up and down changes volume, [ ] changes speed, and
                    f toggles fullscreen. You can click the seek bar to jump.
                  </div>
                  {videoPlaybackError ? (
                    <div className="navigation-hint" role="alert">
                      Video error: {videoPlaybackError}
                    </div>
                  ) : null}
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
