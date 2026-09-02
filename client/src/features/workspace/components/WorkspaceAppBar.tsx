import { Download, FolderTree, Plus, Settings } from "lucide-react";

export type WorkspaceView = "downloads" | "explore";
type WorkspaceAppBarProps = {
  activeView: WorkspaceView;
  onAddDownloads: () => void;
  onOpenSettings: () => void;
  onSelectView: (view: WorkspaceView) => void;
};

export function WorkspaceAppBar({
  activeView,
  onAddDownloads,
  onOpenSettings,
  onSelectView,
}: WorkspaceAppBarProps) {
  return (
    <div className="workspace-appbar">
      <div className="workspace-brand" aria-label="ZIP Image Viewer">
        <span className="workspace-brand-mark" aria-hidden="true">
          ZV
        </span>
        <div>
          <p className="panel-label">ZIP Image Viewer</p>
          <h1>Transfer desk</h1>
        </div>
      </div>
      <nav className="workspace-tabs" role="tablist" aria-label="Workspace">
        <button
          className={activeView === "downloads" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeView === "downloads"}
          onClick={() => onSelectView("downloads")}
        >
          <Download size={16} aria-hidden="true" />
          Downloads
        </button>
        <button
          className={activeView === "explore" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={activeView === "explore"}
          onClick={() => onSelectView("explore")}
        >
          <FolderTree size={16} aria-hidden="true" />
          Explore
        </button>
      </nav>
      <div className="workspace-appbar-actions">
        <button
          className="primary-button compact-button"
          type="button"
          onClick={onAddDownloads}
        >
          <Plus size={16} aria-hidden="true" />
          Add downloads
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <Settings size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
