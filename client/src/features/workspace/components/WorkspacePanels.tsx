import { useState } from "react";
import type { WorkspacePageController } from "../useWorkspacePageController";
import { workspaceLocationSchema } from "../../../../../shared/contracts";
import { TreeExplorer } from "../../../components/TreeExplorer";
import { PreviewContent } from "../../../components/Preview/PreviewContent";
import { PREVIEW_QUALITY_OPTIONS } from "../../../lib/appConstants";
import { formatBytes, formatDate } from "../../../lib/formatterUtils";
import { formatProgressMessage } from "../../../lib/archiveUiUtils";
import { NestedArchiveDialog } from "./NestedArchiveDialog";
import { WorkspaceLivePreview, WorkspacePreviewRecovery } from "./WorkspacePreviewRecovery";
type ViewProps = { controller: WorkspacePageController };
export function WorkspaceFiles({ controller }: ViewProps) {
  const { selection } = controller.media;
  const { selectedPath, session, setSelectedPath } = controller.state;
  const available =
    !session?.id ||
    !controller.queue.sessionsLoaded ||
    controller.railItems.some(
      ({ id, state }) =>
        id === (controller.state.parents[0]?.sessionId ?? session.id) && state === "ready",
    );
  return (
    <section className="explorer-tree-panel" aria-labelledby="explorer-title">
      <header className="panel-header explorer-header">
        <div className="panel-title-group">
          <p className="panel-label">Files</p>
          <h2 id="explorer-title">{selection.sortedTree?.name || "Explorer"}</h2>
        </div>
        {session ? <span className="panel-chip">{selection.explorerRows.length}</span> : null}
      </header>
      {selection.sortedTree && available ? (
        <TreeExplorer
          rootNode={selection.sortedTree}
          selectedPath={selectedPath}
          onSelect={(node) => {
            if (node.type === "file") {
              setSelectedPath(node.path);
              controller.state.setMobilePane("preview");
            }
          }}
          filters={{
            search: controller.state.search,
            mediaType: controller.state.mediaType,
            onSearch: (value) => controller.state.setSearch(value.slice(0, 200)),
            onMediaType: (value) =>
              controller.state.setMediaType(workspaceLocationSchema.shape.media.parse(value)),
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

export function WorkspacePreview({ controller }: ViewProps) {
  const { image, selection, text, video } = controller.media;
  const { settings, state } = controller;
  if (controller.actions.error)
    return <WorkspacePreviewRecovery controller={controller} message={controller.actions.error} />;
  if (controller.actions.livePreview) return <WorkspaceLivePreview controller={controller} />;
  if (
    state.session?.id &&
    controller.queue.sessionsLoaded &&
    !controller.railItems.some(
      ({ id, state: availability }) =>
        id === (state.parents[0]?.sessionId ?? state.session?.id) && availability === "ready",
    )
  )
    return (
      <WorkspacePreviewRecovery
        controller={controller}
        message="This session is no longer available."
      />
    );
  return (
    <>
      <WorkspaceArchiveAction controller={controller} />
      <PreviewContent
        {...selection}
        {...image}
        {...video}
        activeJob={state.activeJob}
        onOpenDownloads={() => state.setActiveView("downloads")}
        sessionId={state.session?.id || ""}
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
    </>
  );
}

function WorkspaceArchiveAction({ controller }: ViewProps) {
  const { state, actions, media } = controller;
  const [open, setOpen] = useState(false);
  const selected = media.selection.selectedNode;
  if (
    !state.session?.id ||
    selected?.type !== "file" ||
    !/\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i.test(selected.path)
  )
    return null;
  const id = state.session.id;
  return (
    <div className="workspace-archive-action">
      <button
        className="primary-button"
        type="button"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        Open archive
      </button>
      {open ? (
        <NestedArchiveDialog
          key={`${id}:${selected.path}`}
          id={id}
          path={selected.path}
          onClose={() => setOpen(false)}
          onOpen={async (childId) => {
            state.setParents([
              ...state.parents,
              {
                sessionId: id,
                path: selected.path,
                name: state.session?.tree?.name || "Parent archive",
                search: state.search,
                media: state.mediaType,
                sort: state.sortMode,
              },
            ]);
            state.setSearch("");
            state.setMediaType("all");
            state.setMobilePane("preview");
            await actions.openSession(childId, { nested: true });
          }}
        />
      ) : null}
    </div>
  );
}

export function WorkspaceMetadata({ controller }: ViewProps) {
  const { lifecycle, media, state } = controller;
  const selected = media.selection.selectedNode;
  return (
    <section className="workspace-metadata-panel" aria-labelledby="details-title">
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
          onClick={() => {
            if (
              window.confirm(
                "Close this session? Temporary files are deleted unless Keep until the server stops is enabled. Retained torrent files are kept.",
              )
            ) {
              state.setNavigationSessionId(undefined);
              state.setParents([]);
              void lifecycle.clearArchive(true);
            }
          }}
        >
          Close session…
        </button>
      ) : null}
    </section>
  );
}
