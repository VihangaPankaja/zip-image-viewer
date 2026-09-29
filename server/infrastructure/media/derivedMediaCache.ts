import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";

const DERIVED_DIRS = [
  "thumbnails",
  "previews",
  "video-thumbnails",
  "video-storyboards",
  "video-transcodes",
  "video-quality",
] as const;
// A playing HLS client requests a segment every few seconds, with idle gaps.
const ACTIVE_PLAYBACK_MS = 30_000;

type Candidate = {
  path: string;
  session: Session;
  size: number;
  modifiedAt: number;
  isTranscode: boolean;
};

async function diskUsage(
  filePath: string,
): Promise<{ size: number; modifiedAt: number }> {
  const entry = await lstat(filePath).catch(() => null);
  if (!entry || entry.isSymbolicLink()) return { size: 0, modifiedAt: 0 };
  if (!entry.isDirectory())
    return { size: entry.size, modifiedAt: entry.mtimeMs };
  let size = 0;
  let modifiedAt = entry.mtimeMs;
  for (const name of await readdir(filePath).catch(() => [])) {
    const child = await diskUsage(path.join(filePath, name));
    size += child.size;
    modifiedAt = Math.max(modifiedAt, child.modifiedAt);
  }
  return { size, modifiedAt };
}

function protectSession(
  active: Map<string, number>,
  sessionId: string,
): () => void {
  active.set(sessionId, (active.get(sessionId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (active.get(sessionId) ?? 1) - 1;
    if (count) active.set(sessionId, count);
    else active.delete(sessionId);
  };
}

function findRendition(
  transcodes: Map<string, VideoTranscodeEntry>,
  filePath: string,
): VideoRendition | undefined {
  for (const entry of transcodes.values())
    for (const rendition of entry.renditions.values())
      if (rendition.dir === filePath) return rendition;
  return undefined;
}

export function createDerivedMediaCache(
  sessions: Map<string, Session>,
  transcodes: Map<string, VideoTranscodeEntry>,
  budgetBytes: number,
) {
  if (!Number.isFinite(budgetBytes) || budgetBytes < 0)
    throw new RangeError("Invalid derived media budget.");
  const active = new Map<string, number>();
  const evicting = new Map<string, Promise<void>>();
  let pending: Promise<void> | undefined;

  async function sweep(): Promise<void> {
    const candidates: Candidate[] = [];
    let total = 0;
    for (const session of sessions.values()) {
      for (const directory of DERIVED_DIRS) {
        const root = path.join(session.workspaceDir, directory);
        const rootEntry = await lstat(root).catch(() => null);
        if (!rootEntry?.isDirectory() || rootEntry.isSymbolicLink()) continue;
        for (const name of await readdir(root).catch(() => [])) {
          const filePath = path.join(root, name);
          const { size, modifiedAt } = await diskUsage(filePath);
          total += size;
          if (!size) continue;
          candidates.push({
            path: filePath,
            session,
            size,
            modifiedAt,
            isTranscode: directory === "video-transcodes",
          });
        }
      }
    }
    candidates.sort((a, b) => a.modifiedAt - b.modifiedAt);
    for (const candidate of candidates) {
      if (total <= budgetBytes) break;
      if (sessions.get(candidate.session.id) !== candidate.session) continue;
      if (active.has(candidate.session.id)) continue;
      const rendition = candidate.isTranscode
        ? findRendition(transcodes, candidate.path)
        : undefined;
      if (rendition?.status === "queued" || rendition?.status === "running")
        continue;
      if (
        rendition?.lastAccessedAt &&
        Date.now() - rendition.lastAccessedAt < ACTIVE_PLAYBACK_MS
      )
        continue;
      const eviction = rm(candidate.path, {
        recursive: true,
        force: true,
      }).finally(() => {
        if (!rendition) return;
        rendition.status = "idle";
        rendition.availableSegments = 0;
      });
      evicting.set(candidate.session.id, eviction);
      try {
        await eviction;
      } finally {
        evicting.delete(candidate.session.id);
      }
      total -= candidate.size;
    }
    // ponytail: active playback may exceed the budget until its 30-second idle window ends.
  }

  function enforce(): Promise<void> {
    if (pending) return pending;
    pending = sweep().finally(() => {
      pending = undefined;
    });
    return pending;
  }

  return {
    enforce,
    protectSession: (sessionId: string) => protectSession(active, sessionId),
    waitForEviction: (sessionId: string) =>
      evicting.get(sessionId) ?? Promise.resolve(),
  };
}
