import type { ComponentProps } from "react";
import { ExplorerTablePanel } from "../../../components/ExplorerTablePanel";
import { GlobalSettingsSheet } from "../../../components/GlobalSettingsSheet";
import { PreviewContent } from "../../../components/Preview/PreviewContent";
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
import { WorkspaceOverlays } from "./WorkspaceOverlays";
import { WorkspacePresentation } from "./WorkspacePresentation";

type ViewProps = { controller: WorkspacePageController };

export function WorkspacePageView({ controller }: ViewProps) {
  return (
    <WorkspacePresentation
      header={<WorkspaceHeader controller={controller} />}
      sessions={<WorkspaceSessions controller={controller} />}
      files={<WorkspaceFiles controller={controller} />}
      preview={<WorkspacePreview controller={controller} />}
      metadata={<WorkspaceMetadata controller={controller} />}
      settings={<WorkspaceSettings controller={controller} />}
      overlays={<WorkspacePageOverlays controller={controller} />}
    />
  );
}

function WorkspaceHeader({ controller }: ViewProps) {
  const { actions, queue, state } = controller;
  return (
    <WorkspaceAppBar
      isLoading={state.isLoading || queue.isEnqueueing}
      onOpenSettings={() => state.setSettingsOpen(true)}
      onSubmit={(urls) => void actions.submit(urls)}
      setUrl={state.setZipUrl}
      url={state.zipUrl}
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
  const { explorerColumns } = controller.settings;
  const { selectedPath, session, setSelectedPath, setSortMode, sortMode } =
    controller.state;
  return (
    <ExplorerTablePanel
      explorerColumns={explorerColumns}
      explorerRows={selection.explorerRows}
      formatBytes={formatBytes}
      formatDate={formatDate}
      selectedPath={selectedPath}
      session={session}
      setSelectedPath={setSelectedPath}
      setSortMode={setSortMode}
      sortMode={sortMode}
      sortOptions={SORT_OPTIONS}
      sortedTree={selection.sortedTree}
    />
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
      setThumbnailStripExpanded={state.setThumbnailStripExpanded}
      textPreview={text.textPreview}
      thumbnailStripExpanded={state.thumbnailStripExpanded}
    />
  );
}

function WorkspaceMetadata({ controller }: ViewProps) {
  const { lifecycle, media, state } = controller;
  return (
    <section className="workspace-metadata-panel">
      <p className="panel-label">Details</p>
      <h2>{media.selection.selectedNode?.name || "No file selected"}</h2>
      <p>
        {media.selection.selectedNode?.path ||
          "Select a file to inspect its metadata."}
      </p>
      {state.activeJob ? <p>{formatProgressMessage(state.activeJob)}</p> : null}
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
