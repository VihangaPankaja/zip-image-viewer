import { useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

type WorkspaceMobilePane = "sessions" | "files" | "preview";

type WorkspaceLayoutProps = {
  files: ReactNode;
  header: ReactNode;
  metadata: ReactNode;
  preview: ReactNode;
  sessions: ReactNode;
};

const mobileViews: ReadonlyArray<{
  id: WorkspaceMobilePane;
  label: string;
}> = [
  { id: "sessions", label: "Sessions" },
  { id: "files", label: "Files" },
  { id: "preview", label: "Preview" },
];

export function WorkspaceLayout({
  files,
  header,
  metadata,
  preview,
  sessions,
}: WorkspaceLayoutProps) {
  const [mobilePane, setMobilePane] = useState<WorkspaceMobilePane>("preview");

  return (
    <section
      className="unified-workspace"
      data-mobile-pane={mobilePane}
      data-testid="workspace-layout"
    >
      <header className="unified-workspace-header">{header}</header>
      <Group className="workspace-panel-group" orientation="horizontal">
        <Panel defaultSize="19" minSize="14">
          <aside
            className="unified-workspace-sessions"
            tabIndex={0}
            aria-label="Sessions panel"
          >
            {sessions}
          </aside>
        </Panel>
        <Separator className="workspace-resize-handle" />
        <Panel defaultSize="23" minSize="17">
          <aside
            className="unified-workspace-files"
            tabIndex={0}
            aria-label="Files panel"
          >
            {files}
          </aside>
        </Panel>
        <Separator className="workspace-resize-handle" />
        <Panel defaultSize="40" minSize="32">
          <section
            className="unified-workspace-preview"
            tabIndex={0}
            aria-label="Preview panel"
          >
            {preview}
          </section>
        </Panel>
        <Separator className="workspace-resize-handle" />
        <Panel defaultSize="18" minSize="14">
          <aside
            className="unified-workspace-metadata"
            tabIndex={0}
            aria-label="Metadata panel"
          >
            {metadata}
          </aside>
        </Panel>
      </Group>
      <nav className="workspace-mobile-nav" aria-label="Workspace views">
        {mobileViews.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-current={mobilePane === view.id ? "page" : undefined}
            className={mobilePane === view.id ? "active" : ""}
            onClick={() => setMobilePane(view.id)}
          >
            {view.label}
          </button>
        ))}
      </nav>
    </section>
  );
}
