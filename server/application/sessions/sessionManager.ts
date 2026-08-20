import { rm } from "node:fs/promises";
import type { Session, VideoTranscodeEntry } from "../../domain/models.js";

type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;

export function createSessionManager(
  sessions: Map<string, Session>,
  transcodes: Map<string, VideoTranscodeEntry>,
  logEvent: LogEvent,
) {
  async function removeSession(sessionId: string, reason = "manual"): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) return;
    for (const [key, entry] of transcodes.entries()) {
      if (entry.sessionId !== sessionId) continue;
      for (const rendition of entry.renditions.values()) {
        if (rendition.process && !rendition.process.killed) {
          rendition.process.kill("SIGTERM");
        }
      }
      transcodes.delete(key);
    }
    sessions.delete(sessionId);
    await rm(session.workspaceDir, { recursive: true, force: true });
    logEvent("info", "session.removed", {
      sessionId,
      reason,
      workspaceDir: session.workspaceDir,
    });
  }

  function touchSession(sessionId: string): Session | undefined {
    const session = sessions.get(sessionId);
    if (session) session.lastAccessedAt = Date.now();
    return session;
  }

  return { removeSession, touchSession };
}
