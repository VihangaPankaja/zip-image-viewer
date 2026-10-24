import { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

type WorkspaceLayoutProps = {
  mobilePane: "files" | "preview";
  onMobilePaneChange: (pane: "files" | "preview") => void;
  onOpenDownloads: () => void;
  files: ReactNode;
  metadata: ReactNode;
  preview: ReactNode;
  sessions: ReactNode;
};

const mobileViews: ReadonlyArray<{
  id: "files" | "preview";
  label: string;
}> = [
  { id: "files", label: "Files" },
  { id: "preview", label: "Preview" },
];

function useMobileFileDrawer({
  mobilePane,
  onMobilePaneChange,
}: Pick<WorkspaceLayoutProps, "mobilePane" | "onMobilePaneChange">) {
  const filesRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (
      !document.activeElement?.matches(".workspace-pane-control") &&
      window.matchMedia("(width <= 760px), (width <= 960px) and (height <= 500px)").matches
    ) {
      (mobilePane === "files" ? filesRef : previewRef).current?.focus({ preventScroll: true });
    }
  }, [mobilePane]);
  useEffect(() => {
    const sidebar = filesRef.current;
    function closeFiles(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        window.matchMedia("(width <= 760px), (width <= 960px) and (height <= 500px)").matches
      )
        onMobilePaneChange("preview");
    }
    sidebar?.addEventListener("keydown", closeFiles);
    return () => sidebar?.removeEventListener("keydown", closeFiles);
  }, [onMobilePaneChange]);
  return { filesRef, previewRef };
}

export function WorkspaceLayout({
  mobilePane,
  onMobilePaneChange,
  onOpenDownloads,
  files,
  metadata,
  preview,
  sessions,
}: WorkspaceLayoutProps) {
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const { filesRef, previewRef } = useMobileFileDrawer({ mobilePane, onMobilePaneChange });
  return (
    <>
      <Group className="workspace-panel-group" orientation="horizontal">
        <Panel defaultSize="320px" minSize="260px" maxSize="480px">
          <section
            ref={filesRef}
            tabIndex={-1}
            className={`explore-sidebar ${sessionsExpanded ? "sessions-expanded" : "sessions-collapsed"}`}
            aria-label="Explorer sidebar"
          >
            <div className="mobile-file-tools">
              <button
                className="mobile-close-files ghost-button"
                type="button"
                onClick={() => onMobilePaneChange("preview")}
              >
                Close files
              </button>
              <button
                className="mobile-sessions-toggle"
                type="button"
                aria-expanded={sessionsExpanded}
                aria-controls="workspace-sessions"
                onClick={() => setSessionsExpanded(!sessionsExpanded)}
              >
                {sessionsExpanded ? "Hide sessions" : "Show sessions"}
              </button>
            </div>
            <div id="workspace-sessions" className="unified-workspace-sessions">
              {sessions}
            </div>
            <div className="unified-workspace-files">{files}</div>
          </section>
        </Panel>
        <Separator className="workspace-resize-handle" />
        <Panel defaultSize="70" minSize="40">
          <section
            ref={previewRef}
            className="unified-workspace-preview"
            aria-label="Preview panel"
            tabIndex={0}
          >
            <button
              className="mobile-back-action"
              type="button"
              onClick={() => onMobilePaneChange("files")}
            >
              Back to files
            </button>
            {preview}
            <aside className="unified-workspace-metadata" aria-label="Metadata panel">
              {metadata}
            </aside>
          </section>
        </Panel>
      </Group>
      <WorkspaceMobileNavigation
        mobilePane={mobilePane}
        onMobilePaneChange={onMobilePaneChange}
        onOpenDownloads={onOpenDownloads}
      />
    </>
  );
}

function WorkspaceMobileNavigation({
  mobilePane,
  onMobilePaneChange,
  onOpenDownloads,
}: Pick<WorkspaceLayoutProps, "mobilePane" | "onMobilePaneChange" | "onOpenDownloads">) {
  return (
    <nav className="workspace-mobile-nav" aria-label="Workspace views">
      <button type="button" onClick={onOpenDownloads}>
        Downloads
      </button>
      {mobileViews.map((view) => (
        <div className="workspace-mobile-view" key={view.id}>
          <input
            className="workspace-pane-control"
            type="radio"
            name="workspace-pane"
            id={`workspace-pane-${view.id}`}
            aria-label={view.label}
            checked={mobilePane === view.id}
            onChange={() => onMobilePaneChange(view.id)}
          />
          <label htmlFor={`workspace-pane-${view.id}`} data-pane={view.id}>
            {view.label}
          </label>
        </div>
      ))}
    </nav>
  );
}
