import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

type WorkspaceLayoutProps = {
  files: ReactNode;
  header: ReactNode;
  metadata: ReactNode;
  preview: ReactNode;
  sessions: ReactNode;
};

const mobileViews: ReadonlyArray<{
  id: "sessions" | "files" | "preview";
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
  return (
    <section className="unified-workspace" data-testid="workspace-layout">
      <header className="unified-workspace-header">{header}</header>
      <Group className="workspace-panel-group" orientation="horizontal">
        <Panel defaultSize="19" minSize="14">
          <section
            className="unified-workspace-sessions"
            aria-label="Sessions panel"
          >
            {sessions}
          </section>
        </Panel>
        <Separator className="workspace-resize-handle" />
        <Panel defaultSize="23" minSize="17">
          <section className="unified-workspace-files" aria-label="Files panel">
            {files}
          </section>
        </Panel>
        <Separator className="workspace-resize-handle" />
        <Panel defaultSize="40" minSize="32">
          <section
            className="unified-workspace-preview"
            aria-label="Preview panel"
          >
            {preview}
          </section>
        </Panel>
        <Separator className="workspace-resize-handle" />
        <Panel defaultSize="18" minSize="14">
          <aside
            className="unified-workspace-metadata"
            aria-label="Metadata panel"
          >
            {metadata}
          </aside>
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
              defaultChecked={view.id === "preview"}
            />
            <label htmlFor={`workspace-pane-${view.id}`} data-pane={view.id}>
              {view.label}
            </label>
          </div>
        ))}
      </nav>
    </section>
  );
}
