import type { LivePreview } from "../../features/workspace/workspaceRail";

type SessionRailState = "downloading" | "ready";

export type SessionRailItem = {
  detail: string;
  id: string;
  label: string;
  state: SessionRailState;
  livePreview?: LivePreview;
};

type SessionRailProps = {
  activeId: string;
  onSelect: (id: string) => void;
  onOpenDownloads: () => void;
  sessions: readonly SessionRailItem[];
};

const stateLabels: Record<SessionRailState, string> = {
  downloading: "Play while downloading",
  ready: "Ready",
};

export function SessionRail({ activeId, onSelect, onOpenDownloads, sessions }: SessionRailProps) {
  return (
    <section className="session-rail" aria-labelledby="sessions-title">
      <div className="session-rail-heading">
        <div>
          <p className="panel-label">Workspace</p>
          <h2 id="sessions-title">Sessions</h2>
        </div>
        <span className="session-count">{sessions.length}</span>
      </div>
      {sessions.length === 0 ? (
        <div className="session-empty">
          <p>No previews available yet. Ready files and playable torrents appear here.</p>
          <button className="ghost-button" type="button" onClick={onOpenDownloads}>
            View downloads
          </button>
        </div>
      ) : (
        <ol className="session-list" aria-label="Sessions">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                className={`session-item ${session.id === activeId ? "active" : ""}`}
                type="button"
                aria-current={session.id === activeId ? "true" : undefined}
                aria-label={`Open ${session.label}`}
                title={session.label}
                onClick={() => onSelect(session.id)}
              >
                <span className={`session-state state-${session.state}`}>
                  {stateLabels[session.state]}
                </span>
                <strong>{session.label}</strong>
                <span>{session.detail}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {sessions.length > 0 ? (
        <button className="ghost-button" type="button" onClick={onOpenDownloads}>
          Manage downloads
        </button>
      ) : null}
    </section>
  );
}
