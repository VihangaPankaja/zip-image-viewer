import type { ReactNode } from "react";
import { WorkspaceLayout } from "./WorkspaceLayout";

type WorkspacePresentationProps = {
  files: ReactNode;
  header: ReactNode;
  metadata: ReactNode;
  overlays: ReactNode;
  preview: ReactNode;
  sessions: ReactNode;
  settings: ReactNode;
};

export function WorkspacePresentation({
  files,
  header,
  metadata,
  overlays,
  preview,
  sessions,
  settings,
}: WorkspacePresentationProps) {
  return (
    <div className="app-shell">
      <main className="workspace">
        <WorkspaceLayout
          header={header}
          sessions={sessions}
          files={files}
          preview={preview}
          metadata={metadata}
        />
      </main>
      {settings}
      {overlays}
    </div>
  );
}
