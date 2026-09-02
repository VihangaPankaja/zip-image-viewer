import type { ComponentProps } from "react";
import { CustomDropdown } from "../../../components/Common/CustomDropdown";
import { GlobalSettingsSheet } from "../../../components/GlobalSettingsSheet";
import { PreviewContent } from "../../../components/Preview/PreviewContent";
import { TreeExplorer } from "../../../components/TreeExplorer";
import { SessionRail } from "../../../components/Workspace/SessionRail";
import {
  DOWNLOAD_RETRY_OPTIONS,
  DOWNLOAD_THREAD_MODE_OPTIONS,
  PREVIEW_QUALITY_OPTIONS,
  SLIDESHOW_FIT_OPTIONS,
  SORT_OPTIONS,
  VIDEO_TRANSCODE_QUALITY_OPTIONS,
} from "../../../lib/appConstants";
import { formatProgressMessage } from "../../../lib/archiveUiUtils";
import {
  clampNumber,
  downloadOptionsToLegacySettings,
  normalizeDownloadOptions,
  normalizeDownloadSettings,
} from "../../../lib/downloadOptions";
import { formatBytes, formatDate } from "../../../lib/formatterUtils";
import type { WorkspacePageController } from "../useWorkspacePageController";
import { WorkspaceAppBar } from "./WorkspaceAppBar";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceOverlays } from "./WorkspaceOverlays";
import { DownloadDialog, DownloadManager } from "./DownloadManager";

type ViewProps = { controller: WorkspacePageController };

export function WorkspacePageView({ controller }: ViewProps) {
  const { queue, settings, state } = controller;
  const downloads = (
    <DownloadManager
      jobs={queue.jobs}
      maxConcurrent={queue.maxConcurrent}
      onCancel={(id) => void queue.cancel(id)}
      onOpenSession={(jobId) => {
        const sessionId = queue.jobs.find(({ id }) => id === jobId)?.sessionId;
        if (sessionId) void controller.actions.openSession(sessionId);
      }}
      onPause={(id) => void queue.pause(id)}
      onRemove={(id) => void queue.remove(id)}
      onReorder={(ids) => void queue.reorder(ids)}
      onResume={(id) => void queue.resume(id)}
      onRetry={(id) => void queue.retry(id)}
      onSetConcurrency={(value) => void queue.setMaxConcurrent(value)}
    />
  );
  return (
    <div className="app-shell">
      <main className="workspace">
        {state.activeView === "downloads" ? (
          <section className="unified-workspace downloads-workspace">
            <header className="unified-workspace-header">
              <WorkspaceHeader controller={controller} />
            </header>
            {downloads}
          </section>
        ) : (
          <WorkspaceLayout
            header={<WorkspaceHeader controller={controller} />}
            sessions={<WorkspaceSessions controller={controller} />}
            files={<WorkspaceFiles controller={controller} />}
            preview={<WorkspacePreview controller={controller} />}
            metadata={<WorkspaceMetadata controller={controller} />}
          />
        )}
      </main>
      <WorkspaceSettings controller={controller} />
      <DownloadDialog
        defaultOptions={settings.downloadOptions}
        open={state.downloadDialogOpen}
        onClose={() => state.setDownloadDialogOpen(false)}
        onSubmit={(items) => {
          void queue
            .enqueue(items)
            .then(() => state.setDownloadDialogOpen(false));
        }}
      />
      {state.activeView === "explore" ? (
        <WorkspacePageOverlays controller={controller} />
      ) : null}
    </div>
  );
}

function WorkspaceHeader({ controller }: ViewProps) {
  const { state } = controller;
  return (
    <WorkspaceAppBar
      activeView={state.activeView}
      onAddDownloads={() => state.setDownloadDialogOpen(true)}
      onOpenSettings={() => state.setSettingsOpen(true)}
      onSelectView={state.setActiveView}
    />
  );
}

function WorkspaceSessions({ controller }: ViewProps) {
  const { actions, railItems, state } = controller;
  return (
    <SessionRail
      activeId={state.session?.id || state.activeJob?.id || ""}
      sessions={railItems}
      onSelect={(id) => void actions.openSession(id)}
    />
  );
}

function WorkspaceFiles({ controller }: ViewProps) {
  const { selection } = controller.media;
  const { selectedPath, session, setSelectedPath, setSortMode, sortMode } =
    controller.state;
  return (
    <section className="explorer-tree-panel" aria-labelledby="explorer-title">
      <header className="panel-header explorer-header">
        <div className="panel-title-group">
          <p className="panel-label">Files</p>
          <h2 id="explorer-title">
            {selection.sortedTree?.name || "Explorer"}
          </h2>
        </div>
        {session ? (
          <span className="panel-chip">{selection.explorerRows.length}</span>
        ) : null}
        <CustomDropdown
          id="sort-mode-explorer"
          label="Sort"
          value={sortMode}
          options={SORT_OPTIONS}
          onChange={(value) => setSortMode(String(value))}
          className="explorer-sort-shell"
        />
      </header>
      {selection.sortedTree ? (
        <TreeExplorer
          compact
          rootNode={selection.sortedTree}
          selectedPath={selectedPath}
          onSelect={(node) => {
            if (node.type === "file") setSelectedPath(node.path);
          }}
        />
      ) : (
        <div className="empty-card">
          <strong>No session selected</strong>
          <p>Open a completed download to explore its files.</p>
        </div>
      )}
    </section>
  );
}

function WorkspacePreview({ controller }: ViewProps) {
  const { image, selection, text, video } = controller.media;
  const { settings, state } = controller;
  return (
    <PreviewContent
      {...selection}
      {...image}
      {...video}
      activeJob={state.activeJob}
      formatBytes={formatBytes}
      formatDate={formatDate}
      keyboardSettings={settings.keyboardSettings}
      previewQuality={state.previewQuality}
      previewQualityOptions={PREVIEW_QUALITY_OPTIONS}
      selectedPath={state.selectedPath}
      setExplorerModalOpen={state.setExplorerModalOpen}
      setPreviewQuality={state.setPreviewQuality}
      setSelectedPath={state.setSelectedPath}
      setSlideshowOpen={state.setSlideshowOpen}
      textPreview={text.textPreview}
    />
  );
}

function WorkspaceMetadata({ controller }: ViewProps) {
  const { lifecycle, media, state } = controller;
  const selected = media.selection.selectedNode;
  return (
    <section
      className="workspace-metadata-panel"
      aria-labelledby="details-title"
    >
      <p className="panel-label">Selection</p>
      <h2 id="details-title">Details</h2>
      <dl>
        <div>
          <dt>File</dt>
          <dd>{selected?.name || "No file selected"}</dd>
        </div>
        <div>
          <dt>Path</dt>
          <dd>{selected?.path || "Select a file to inspect its metadata."}</dd>
        </div>
        {state.activeJob ? (
          <div>
            <dt>Status</dt>
            <dd>{formatProgressMessage(state.activeJob)}</dd>
          </div>
        ) : null}
      </dl>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.session ? (
        <button
          className="ghost-button"
          type="button"
          onClick={() => void lifecycle.clearArchive(true)}
        >
          Close session
        </button>
      ) : null}
    </section>
  );
}

function WorkspaceSettings({ controller }: ViewProps) {
  const { downloadSettings, settings, state } = controller;
  const updateDownloadSettings: ComponentProps<
    typeof GlobalSettingsSheet
  >["setDownloadSettings"] = (update) => {
    settings.setDownloadOptions((current) =>
      normalizeDownloadOptions(
        typeof update === "function"
          ? update(downloadOptionsToLegacySettings(current))
          : update,
      ),
    );
  };
  return (
    <GlobalSettingsSheet
      {...settings}
      {...state}
      clampNumber={clampNumber}
      downloadRetryOptions={DOWNLOAD_RETRY_OPTIONS}
      downloadSettings={downloadSettings}
      downloadThreadModeOptions={DOWNLOAD_THREAD_MODE_OPTIONS}
      normalizeDownloadSettings={normalizeDownloadSettings}
      previewQualityOptions={PREVIEW_QUALITY_OPTIONS}
      setDownloadSettings={updateDownloadSettings}
      setVideoTranscodeQuality={(videoQuality) =>
        settings.setDownloadOptions((current) =>
          normalizeDownloadOptions({
            ...current,
            media: { ...current.media, videoQuality },
          }),
        )
      }
      sortOptions={SORT_OPTIONS}
      videoTranscodeQuality={downloadSettings.videoQuality}
      videoTranscodeQualityOptions={VIDEO_TRANSCODE_QUALITY_OPTIONS}
    />
  );
}

function WorkspacePageOverlays({ controller }: ViewProps) {
  const { image, selection } = controller.media;
  const { state } = controller;
  return (
    <WorkspaceOverlays
      {...selection}
      {...state}
      currentFolderImages={selection.currentFolderImages}
      formatBytes={formatBytes}
      formatDate={formatDate}
      onCloseExplorer={() => state.setExplorerModalOpen(false)}
      onCloseSlideshow={() => state.setSlideshowOpen(false)}
      onSelectPath={state.setSelectedPath}
      selectedImageUrl={
        image.selectedImageSrc || selection.selectedImagePreviewUrl
      }
      slideshowFitOptions={SLIDESHOW_FIT_OPTIONS}
    />
  );
}
