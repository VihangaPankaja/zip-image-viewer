import { useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

type WorkspaceLayoutProps = {
  mobilePane: "files" | "preview";
  onMobilePaneChange: (pane: "files" | "preview") => void;
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

export function WorkspaceLayout({
  mobilePane,
  onMobilePaneChange,
  files,
  metadata,
  preview,
  sessions,
}: WorkspaceLayoutProps) {
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  return (
    <>
      <Group className="workspace-panel-group" orientation="horizontal">
        <Panel defaultSize="30" minSize="20">
          <section
            className={`explore-sidebar ${sessionsExpanded ? "sessions-expanded" : "sessions-collapsed"}`}
            aria-label="Explorer sidebar"
          >
            <button
              className="mobile-sessions-toggle"
              type="button"
              aria-expanded={sessionsExpanded}
              aria-controls="workspace-sessions"
              onClick={() => setSessionsExpanded(!sessionsExpanded)}
            >
              {sessionsExpanded ? "Hide sessions" : "Show sessions"}
            </button>
            <div id="workspace-sessions" className="unified-workspace-sessions">
              {sessions}
            </div>
            <div className="unified-workspace-files">{files}</div>
          </section>
        </Panel>
        <Separator className="workspace-resize-handle" />
        <Panel defaultSize="70" minSize="40">
          <section
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
            <aside
              className="unified-workspace-metadata"
              aria-label="Metadata panel"
            >
              {metadata}
            </aside>
          </section>
        </Panel>
      </Group>
      <nav className="workspace-mobile-nav" aria-label="Workspace views">
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
    </>
  );
}
