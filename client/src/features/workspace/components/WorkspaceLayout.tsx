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
  id: "files" | "preview";
  label: string;
}> = [
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
        <Panel defaultSize="30" minSize="20">
          <section className="explore-sidebar" aria-label="Explorer sidebar">
            <div className="unified-workspace-sessions">{sessions}</div>
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
            <label
              className="mobile-back-action"
              htmlFor="workspace-pane-files"
            >
              Back to files
            </label>
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
              defaultChecked={view.id === "files"}
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
