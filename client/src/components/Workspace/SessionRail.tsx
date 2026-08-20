export type SessionRailState = "downloading" | "ready" | "error";

export type SessionRailItem = {
  detail: string;
  id: string;
  label: string;
  state: SessionRailState;
};

type SessionRailProps = {
  activeId: string;
  onSelect: (id: string) => void;
  sessions: readonly SessionRailItem[];
};

const stateLabels: Record<SessionRailState, string> = {
  downloading: "Downloading",
  error: "Needs attention",
  ready: "Ready",
};

export function SessionRail({
  activeId,
  onSelect,
  sessions,
}: SessionRailProps) {
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
        <p className="session-empty">Queued downloads will appear here.</p>
      ) : (
        <ol className="session-list" aria-label="Sessions">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                className={`session-item ${session.id === activeId ? "active" : ""}`}
                type="button"
                aria-current={session.id === activeId ? "true" : undefined}
                aria-label={`Open ${session.label}`}
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
    </section>
  );
}
