import { WorkspaceFiles, WorkspacePreview, WorkspaceMetadata } from "./WorkspacePanels";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { useState } from "react";
import { SessionStorageDialog } from "./SessionStorageDialog";
import { SessionRail } from "../../../components/Workspace/SessionRail";
import { SLIDESHOW_FIT_OPTIONS } from "../../../lib/appConstants";
import { formatBytes, formatDate } from "../../../lib/formatterUtils";
import type { WorkspacePageController } from "../useWorkspacePageController";
import { WorkspaceAppBar } from "./WorkspaceAppBar";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceOverlays } from "./WorkspaceOverlays";
import { DownloadDialog, DownloadManager } from "./DownloadManager";
import { AudioPlayerProvider } from "../../player/AudioPlayerProvider";
import { WorkspaceBreadcrumbs } from "./WorkspaceBreadcrumbs";
import { WorkspaceHelp } from "./WorkspaceHelp";

type ViewProps = { controller: WorkspacePageController };

export function WorkspacePageView({ controller }: ViewProps) {
  const { queue, state } = controller;
  const [storageOpen, setStorageOpen] = useState(false);
  const sessionAvailable =
    !queue.sessionsLoaded ||
    controller.railItems.some(
      (item) =>
        item.id === (state.parents[0]?.sessionId ?? state.session?.id) && item.state === "ready",
    );
  return (
    <AudioPlayerProvider
      sessionId={sessionAvailable ? state.session?.id || "" : ""}
      files={controller.media.selection.explorerRows}
      selectedPath={state.selectedPath}
      filesVisible={state.mobilePane === "files"}
      videoVisible={
        state.activeView === "explore" &&
        !controller.actions.error &&
        (controller.media.selection.selectedKind === "video" ||
          Boolean(controller.actions.livePreview))
      }
      visible={
        state.activeView === "explore" &&
        controller.media.selection.selectedKind === "audio" &&
        !controller.actions.livePreview &&
        !controller.actions.error
      }
      onSelect={state.setSelectedPath}
      onReveal={() => {
        state.setActiveView("explore");
        state.setMobilePane("preview");
      }}
    >
      <div className="app-shell">
        <main className="workspace">
          <section
            className={`unified-workspace ${state.activeView === "downloads" ? "downloads-workspace" : ""}`}
          >
            <header className="unified-workspace-header">
              <WorkspaceHeader controller={controller} onOpenStorage={() => setStorageOpen(true)} />
              {state.activeView === "explore" ? (
                <WorkspaceBreadcrumbs controller={controller} />
              ) : null}
            </header>
            {state.activeView === "downloads" ? (
              <WorkspaceDownloads controller={controller} />
            ) : null}
            <div className="workspace-explore-content" hidden={state.activeView !== "explore"}>
              <WorkspaceLayout
                mobilePane={state.mobilePane}
                onMobilePaneChange={state.setMobilePane}
                onOpenDownloads={() => state.setActiveView("downloads")}
                sessions={<WorkspaceSessions controller={controller} />}
                files={<WorkspaceFiles controller={controller} />}
                preview={<WorkspacePreview controller={controller} />}
                metadata={<WorkspaceMetadata controller={controller} />}
              />
            </div>
          </section>
        </main>
        <WorkspaceSettings controller={controller} />
        {state.helpOpen ? <WorkspaceHelp onClose={() => state.setHelpOpen(false)} /> : null}
        <WorkspaceDownloadEntry controller={controller} />
        {state.activeView === "explore" ? <WorkspacePageOverlays controller={controller} /> : null}
        {storageOpen && state.session?.id ? (
          <SessionStorageDialog
            id={state.session.id}
            onClose={() => setStorageOpen(false)}
            onDeleted={async () => {
              state.setNavigationSessionId(undefined);
              state.setParents([]);
              await controller.lifecycle.clearArchive(false);
            }}
          />
        ) : null}
      </div>
    </AudioPlayerProvider>
  );
}

function WorkspaceDownloads({ controller }: ViewProps) {
  const { queue } = controller;
  return (
    <DownloadManager
      jobs={queue.jobs}
      onCancel={(id) => void queue.cancel(id)}
      onSelectFiles={(id, fileIds) => queue.selectFiles(id, fileIds).then(() => undefined)}
      onFilePriority={(id, fileId, priority) =>
        queue.setFilePriority(id, fileId, priority).then(() => undefined)
      }
      onConfirm={(id) => queue.confirm(id).then(() => undefined)}
      onOpenSession={(jobId) => {
        const sessionId = queue.jobs.find(({ id }) => id === jobId)?.sessionId;
        if (sessionId) void controller.actions.openSession(sessionId);
      }}
      onPause={(id) => void queue.pause(id)}
      onRemove={(id) => void queue.remove(id)}
      onReorder={(ids) => void queue.reorder(ids)}
      onResume={(id) => void queue.resume(id)}
      onRetry={(id) => void queue.retry(id)}
    />
  );
}

function WorkspaceHeader({ controller, onOpenStorage }: ViewProps & { onOpenStorage: () => void }) {
  const { state } = controller;
  return (
    <WorkspaceAppBar
      activeView={state.activeView}
      onAddDownloads={() => state.setDownloadDialogOpen(true)}
      onOpenSettings={() => state.setSettingsOpen(true)}
      onOpenHelp={() => state.setHelpOpen(true)}
      onSelectView={state.setActiveView}
      onOpenStorage={state.session && !state.parents.length ? onOpenStorage : undefined}
    />
  );
}

function WorkspaceSessions({ controller }: ViewProps) {
  const { actions, railItems, state } = controller;
  return (
    <SessionRail
      activeId={
        actions.livePreview
          ? controller.queue.sessions.find(
              ({ jobId, fileCount }) => fileCount > 0 && jobId === actions.livePreview?.jobId,
            )?.id ||
            controller.queue.jobs.find(({ id }) => id === actions.livePreview?.jobId)?.sessionId ||
            actions.livePreview.jobId
          : state.parents[0]?.sessionId || state.session?.id || ""
      }
      sessions={railItems}
      onSelect={actions.selectPreview}
      onOpenDownloads={() => state.setActiveView("downloads")}
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
      selectedImageUrl={image.selectedImageSrc || selection.selectedImagePreviewUrl}
      slideshowFitOptions={SLIDESHOW_FIT_OPTIONS}
    />
  );
}

function WorkspaceDownloadEntry({ controller }: ViewProps) {
  const { settings, state, queue } = controller;
  return (
    <DownloadDialog
      defaultOptions={settings.downloadOptions}
      open={state.downloadDialogOpen}
      onClose={() => state.setDownloadDialogOpen(false)}
      onSubmit={async (items) => {
        await queue.enqueue(items);
        state.setDownloadDialogOpen(false);
      }}
    />
  );
}
