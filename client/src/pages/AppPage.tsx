import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import { CustomDropdown } from "../components/Common/CustomDropdown";
import { getVideoMimeType } from "../lib/mimeTypeSystem";
import {
  DOWNLOAD_RETRY_OPTIONS,
  DOWNLOAD_THREAD_MODE_OPTIONS,
  PREVIEW_QUALITY_OPTIONS,
  SLIDESHOW_FIT_OPTIONS,
  SORT_OPTIONS,
  VIDEO_TRANSCODE_QUALITY_OPTIONS,
  WORKSPACE_TABS,
} from "../lib/appConstants";
import { formatProgressMessage } from "../lib/archiveUiUtils";
import {
  clampNumber,
  downloadOptionsToLegacySettings,
  normalizeDownloadOptions,
  normalizeDownloadSettings,
} from "../lib/downloadOptions";
import { useImagePreviewCache } from "../hooks/useImagePreviewCache";
import { useLocalStorageSettings } from "../hooks/useLocalStorageSettings";
import { usePreviewSelection } from "../hooks/usePreviewSelection";
import { useSessionLifecycle } from "../hooks/useSessionLifecycle";
import { useTextPreview } from "../hooks/useTextPreview";
import {
  formatBytes,
  formatDate,
  formatEta,
  formatSpeed,
  formatTransferBytes,
} from "../lib/formatterUtils";
import { getFirstFilePath } from "../lib/treeUtils";
import { fetchJson } from "../services/apiClient";
import {
  WorkspaceTabs,
  type WorkspaceTabId,
} from "../components/WorkspaceTabs";
import { GlobalSettingsSheet } from "../components/GlobalSettingsSheet";
import { TreeExplorer } from "../components/TreeExplorer";
import { DownloadTabPage } from "../components/Pages/DownloadTabPage";
import { PreviewTabPage } from "../components/Pages/PreviewTabPage";
import { ExplorerTabPage } from "../components/Pages/ExplorerTabPage";

function App() {
  const [zipUrl, setZipUrl] = useState("");
  const [activeTab, setActiveTab] = useState<WorkspaceTabId>("download");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState(null);
  const {
    theme,
    setTheme,
    keyboardSettings,
    setKeyboardSettings,
    explorerColumns,
    setExplorerColumns,
    downloadOptions,
    setDownloadOptions,
  } = useLocalStorageSettings();
  const [selectedPath, setSelectedPath] = useState("");
  const [sortMode, setSortMode] = useState("natural-tail");
  const [previewQuality, setPreviewQuality] = useState("balanced");
  const [thumbnailStripExpanded, setThumbnailStripExpanded] = useState(false);
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
  const downloadSettings = useMemo(
    () => downloadOptionsToLegacySettings(downloadOptions),
    [downloadOptions],
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const seekDebounceRef = useRef<number | null>(null);
  const videoShellRef = useRef<HTMLDivElement | null>(null);
  const [videoQualityOptions, setVideoQualityOptions] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [selectedVideoQuality, setSelectedVideoQuality] = useState("source");

  const {
    sortedTree,
    flatData,
    selectedNode,
    selectedKind,
    currentFolderImages,
    currentImageIndex,
    selectedFileUrl,
    selectedImagePreviewUrl,
    selectedPreviewUrl,
    currentFolderImageItems,
    visibleThumbnailItems,
    previousImagePath,
    nextImagePath,
    previousImageName,
    nextImageName,
    explorerRows,
  } = usePreviewSelection({
    session,
    sortMode,
    selectedPath,
    previewQuality,
    thumbnailStripExpanded,
  });
  const { textPreview, resetTextPreview, clearTextPreviewCache } =
    useTextPreview({
      selectedNode,
      selectedKind,
      selectedPreviewUrl,
      sessionId: session?.id || "",
    });
  const {
    selectedImageSrc,
    resetSelectedImageSrc,
    clearImagePreviewCache,
    loadImagePreview,
  } = useImagePreviewCache({
    sessionId: session?.id || "",
    selectedNode,
    selectedKind,
    previewQuality,
    selectedImagePreviewUrl,
  });
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

  const { clearArchive, handleSubmit } = useSessionLifecycle({
    zipUrl,
    setZipUrl,
    session,
    activeJob,
    setSession,
    setActiveJob,
    setSelectedPath,
    setOversizePrompt,
    setError,
    setIsLoading,
    setSlideshowOpen,
    setThumbnailStripExpanded,
    resetTextPreview,
    resetSelectedImageSrc,
    clearTextPreviewCache,
    clearImagePreviewCache,
    downloadOptions,
    downloadSettings,
  });

  useEffect(() => {
    if (!flatData || !sortedTree) {
      return;
    }

    if (!selectedPath || !flatData.nodesByPath.has(selectedPath)) {
      setSelectedPath(getFirstFilePath(sortedTree));
    }
  }, [flatData, selectedPath, sortedTree]);

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
    loadImagePreview,
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
          <DownloadTabPage
            theme={theme}
            setTheme={setTheme}
            zipUrl={zipUrl}
            setZipUrl={setZipUrl}
            handleSubmit={handleSubmit}
            isLoading={isLoading}
            activeJob={activeJob}
            downloadSettings={downloadSettings}
            visualPercent={visualPercent}
            visualPercentLabel={visualPercentLabel}
            visualProgressWidth={visualProgressWidth}
            transferLabel={transferLabel}
            speedLabel={speedLabel}
            etaLabel={etaLabel}
            modeLabel={modeLabel}
            threadLabel={threadLabel}
            retryLabel={retryLabel}
            formatProgressMessage={formatProgressMessage}
            clearArchive={clearArchive}
            session={session}
            error={error}
            oversizePrompt={oversizePrompt}
            setOversizePrompt={setOversizePrompt}
            setIsLoading={setIsLoading}
          />
        ) : null}

        {activeTab === "preview" ? (
          <PreviewTabPage
            sortedTree={sortedTree}
            session={session}
            sortMode={sortMode}
            setSortMode={setSortMode}
            sortOptions={SORT_OPTIONS}
            selectedPath={selectedPath}
            setSelectedPath={setSelectedPath}
            selectedNode={selectedNode}
            selectedKind={selectedKind}
            setExplorerModalOpen={setExplorerModalOpen}
            setSlideshowOpen={setSlideshowOpen}
            selectedFileUrl={selectedFileUrl}
            formatBytes={formatBytes}
            formatDate={formatDate}
            textPreview={textPreview}
            currentImageIndex={currentImageIndex}
            currentFolderImages={currentFolderImages}
            previewQuality={previewQuality}
            previewQualityOptions={PREVIEW_QUALITY_OPTIONS}
            setPreviewQuality={setPreviewQuality}
            selectedImageSrc={selectedImageSrc}
            selectedImagePreviewUrl={selectedImagePreviewUrl}
            currentFolderImageItems={currentFolderImageItems}
            thumbnailStripExpanded={thumbnailStripExpanded}
            setThumbnailStripExpanded={setThumbnailStripExpanded}
            visibleThumbnailItems={visibleThumbnailItems}
            videoQualityOptions={videoQualityOptions}
            selectedVideoQuality={selectedVideoQuality}
            setSelectedVideoQuality={setSelectedVideoQuality}
            videoShellRef={videoShellRef}
            videoRef={videoRef}
            videoIsPlaying={videoIsPlaying}
            toggleVideoPlayback={toggleVideoPlayback}
            videoCurrentTime={videoCurrentTime}
            videoDuration={videoDuration}
            videoBufferedPercent={videoBufferedPercent}
            videoPlayedPercent={videoPlayedPercent}
            seekVideoTo={seekVideoTo}
            setVideoSeekHoverTime={setVideoSeekHoverTime}
            videoSeekHoverTime={videoSeekHoverTime}
            videoSeekPreviewUrl={videoSeekPreviewUrl}
            videoVolume={videoVolume}
            setVideoVolume={setVideoVolume}
            videoPlaybackRate={videoPlaybackRate}
            setVideoPlaybackRate={setVideoPlaybackRate}
            videoIsFullscreen={videoIsFullscreen}
            toggleVideoFullscreen={toggleVideoFullscreen}
            keyboardSettings={keyboardSettings}
            activeJob={activeJob}
            videoPlaybackError={videoPlaybackError}
          />
        ) : null}

        {activeTab === "explorer" ? (
          <ExplorerTabPage
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
