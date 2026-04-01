import React from "react";

/* eslint-disable no-unused-vars */

export type WorkspaceTabId = "download" | "preview" | "explorer";

export type TabOption = {
  value: WorkspaceTabId;
  label: string;
};

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
