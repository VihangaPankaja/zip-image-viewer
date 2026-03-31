import React from "react";

/* eslint-disable no-unused-vars */

/**
 * @contract WorkspaceNavigation
 * Defines the primary navigation model for the workspace.
 * - `download`: Initial state, handles URL input and job progress.
 * - `preview`: Main viewing area for the selected file.
 * - `slideshow`: Dedicated tab for image slideshows (replaces modal slideshow).
 *
 * Note: The `explorer` tab has been removed in favor of a modal triggered from `preview`.
 */
export type WorkspaceTabId = "download" | "preview" | "slideshow";

export type TabOption = {
  value: WorkspaceTabId;
  label: string;
};

/**
 * @contract ExplorerModal
 * Defines the interaction contract for the Explorer modal.
 * The Explorer is triggered from the Preview tab to select files.
 */
export interface ExplorerModalContract {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onFileSelect: (path: string) => void;
}

/**
 * @contract SlideshowTab
 * Defines the interaction contract for the Slideshow tab.
 * - `F` key toggles fullscreen mode when this tab is active.
 */
export interface SlideshowTabContract {
  isActive: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

type WorkspaceTabsProps = {
  tabs: TabOption[];
  activeTab: WorkspaceTabId;
  onTabChange: (value: WorkspaceTabId) => void;
  onOpenSettings: () => void;
};

export function WorkspaceTabs({
  tabs,
  activeTab,
  onTabChange,
  onOpenSettings,
}: WorkspaceTabsProps) {
  return (
    <div className="workspace-switcher">
      <div
        className="workspace-tabs"
        role="tablist"
        aria-label="Workspace tabs"
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            className={`tab-button ${activeTab === tab.value ? "active" : ""}`}
            onClick={() => onTabChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <button
        className="ghost-button compact-button"
        type="button"
        onClick={onOpenSettings}
      >
        Global settings
      </button>
    </div>
  );
}
