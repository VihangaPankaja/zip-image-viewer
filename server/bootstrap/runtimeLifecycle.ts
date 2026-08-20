import type { Server } from "node:http";
import type { Session, SessionJob } from "../domain/models.js";
import {
  CLEANUP_INTERVAL_MS,
  SESSION_TTL_MS,
} from "../config/runtimeConstants.js";

type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;
type Dependencies = {
  sessions: Map<string, Session>;
  jobs: Map<string, SessionJob>;
  getServer: () => Server | undefined;
  removeSession: (_id: string, _reason: string) => Promise<void>;
  cleanupJob: (_id: string, _reason: string) => Promise<void>;
  logEvent: LogEvent;
};

function logFailure(
  logEvent: LogEvent,
  event: string,
  id: string,
  error: unknown,
): void {
  const failure =
    error instanceof Error ? error : new Error("Unexpected cleanup failure");
  logEvent("error", event, {
    id,
    error: failure.message,
    stack: failure.stack,
  });
}

export function registerRuntimeLifecycle(deps: Dependencies): void {
  let shuttingDown = false;
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of deps.sessions) {
      if (now - session.lastAccessedAt > SESSION_TTL_MS) {
        void deps.removeSession(id, "expired").catch((error: unknown) => {
          logFailure(deps.logEvent, "session.cleanup.failed", id, error);
        });
      }
    }
    for (const [id, job] of deps.jobs) {
      if (job.cleanupAt && now > job.cleanupAt) {
        void deps.cleanupJob(id, "expired").catch((error: unknown) => {
          logFailure(deps.logEvent, "job.cleanup.failed", id, error);
        });
      }
    }
  }, CLEANUP_INTERVAL_MS).unref();

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    deps.logEvent("info", "shutdown.start", {
      activeSessions: deps.sessions.size,
    });
    const server = deps.getServer();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await Promise.all(
      [...deps.sessions.keys()].map((id) => deps.removeSession(id, "shutdown")),
    );
    await Promise.all(
      [...deps.jobs.keys()].map((id) => deps.cleanupJob(id, "shutdown")),
    );
    deps.logEvent("info", "shutdown.complete");
    process.exit(0);
  }

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      deps.logEvent("info", "signal.received", { signal });
      void shutdown().catch((error: unknown) => {
        logFailure(deps.logEvent, "shutdown.failed", signal, error);
        process.exit(1);
      });
    });
  }
}
