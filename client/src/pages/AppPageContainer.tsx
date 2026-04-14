import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CustomDropdown } from "../components/Common/CustomDropdown";
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
import { useVideoPlaybackController } from "../hooks/useVideoPlaybackController";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import {
  formatBytes,
  formatDate,
  formatEta,
  formatSpeed,
  formatTransferBytes,
} from "../lib/formatterUtils";
import { getFirstFilePath } from "../lib/treeUtils";
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
  const downloadSettings = useMemo(
    () => downloadOptionsToLegacySettings(downloadOptions),
    [downloadOptions],
  );

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
  const {
    videoRef,
    videoShellRef,
    videoPlaybackRate,
    setVideoPlaybackRate,
    videoVolume,
    setVideoVolume,
    videoPlaybackError,
    videoDuration,
    videoCurrentTime,
    videoIsPlaying,
    videoIsFullscreen,
    videoSeekHoverTime,
    setVideoSeekHoverTime,
    videoSeekPreviewUrl,
    videoQualityOptions,
    selectedVideoQuality,
    setSelectedVideoQuality,
    videoPlayedPercent,
    videoBufferedPercent,
    toggleVideoPlayback,
    seekVideoTo,
    toggleVideoFullscreen,
  } = useVideoPlaybackController({
    session,
    selectedNode,
    selectedKind,
  });

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

  useKeyboardShortcuts({
    keyboardSettings,
    selectedKind,
    videoRef,
    videoShellRef,
    setVideoVolume,
    setVideoPlaybackRate,
    currentImageIndex,
    nextImagePath,
    previousImagePath,
    currentFolderImages,
    slideshowOpen,
    setSelectedPath,
    setSlideshowOpen,
  });

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
