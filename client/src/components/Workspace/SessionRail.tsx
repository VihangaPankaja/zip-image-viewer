import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

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
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sessions.length,
    estimateSize: () => 82,
    getScrollElement: () => listRef.current,
    initialRect: { height: 320, width: 0 },
    overscan: 5,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const sessionPositions: Array<{ index: number; start: number }> =
    virtualItems.length > 0
      ? virtualItems
      : sessions.map((_, index) => ({ index, start: index * 82 }));

  return (
    <aside className="session-rail" aria-label="Sessions and downloads">
      <div className="session-rail-heading">
        <div>
          <p className="panel-label">Workspace</p>
          <h2>Sessions</h2>
        </div>
        <span className="session-count">{sessions.length}</span>
      </div>
      {sessions.length === 0 ? (
        <p className="session-empty">Queued downloads will appear here.</p>
      ) : (
        <div ref={listRef} className="session-list" role="list">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {sessionPositions.map((virtualItem) => {
              const session = sessions[virtualItem.index];
              if (!session) {
                return null;
              }

              return (
                <div
                  key={session.id}
                  role="listitem"
                  style={{
                    position: "absolute",
                    transform: `translateY(${virtualItem.start}px)`,
                    width: "100%",
                  }}
                >
                  <button
                    className={`session-item ${session.id === activeId ? "active" : ""}`}
                    type="button"
                    aria-pressed={session.id === activeId}
                    aria-label={`Open ${session.label}`}
                    onClick={() => onSelect(session.id)}
                  >
                    <span className={`session-state state-${session.state}`}>
                      {stateLabels[session.state]}
                    </span>
                    <strong>{session.label}</strong>
                    <span>{session.detail}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
