import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { ApplicationError } from "../../domain/models.js";

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
  seen = new Set<string>(),
): Promise<{ size: number; modifiedAt: number }> {
  const entry = await lstat(filePath).catch(() => null);
  if (!entry || entry.isSymbolicLink()) return { size: 0, modifiedAt: 0 };
  if (!entry.isDirectory()) {
    const identity = `${entry.dev}:${entry.ino}`;
    if (seen.has(identity)) return { size: 0, modifiedAt: entry.mtimeMs };
    seen.add(identity);
    return { size: entry.size, modifiedAt: entry.mtimeMs };
  }
  let size = 0;
  let modifiedAt = entry.mtimeMs;
  for (const name of await readdir(filePath).catch(() => [])) {
    const child = await diskUsage(path.join(filePath, name), seen);
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

class DerivedMediaCache {
  private readonly active = new Map<string, number>();
  private readonly preparing = new Map<string, number>();
  private readonly evicting = new Map<string, Promise<void>>();
  private pending: Promise<void> | undefined;
  constructor(
    private readonly sessions: Map<string, Session>,
    private readonly transcodes: Map<string, VideoTranscodeEntry>,
    private readonly budgetBytes: number,
  ) {
    if (!Number.isFinite(budgetBytes) || budgetBytes < 0)
      throw new RangeError("Invalid derived media budget.");
  }

  private async sweep(): Promise<void> {
    const candidates: Candidate[] = [];
    let total = 0;
    for (const session of this.sessions.values()) {
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
      if (total <= this.budgetBytes) break;
      if (this.sessions.get(candidate.session.id) !== candidate.session)
        continue;
      if (this.active.has(candidate.session.id)) continue;
      if (this.evicting.has(candidate.session.id)) continue;
      const rendition = candidate.isTranscode
        ? findRendition(this.transcodes, candidate.path)
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
      this.evicting.set(candidate.session.id, eviction);
      try {
        await eviction;
      } finally {
        this.evicting.delete(candidate.session.id);
      }
      total -= candidate.size;
    }
    // ponytail: active playback may exceed the budget until its 30-second idle window ends.
  }

  enforce = (): Promise<void> => {
    if (this.pending) return this.pending;
    this.pending = this.sweep().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  };

  storage = async (session: Session) => {
    const seen = new Set<string>();
    let originalsBytes = 0;
    let previewsBytes = 0;
    let transcodesBytes = 0;
    for (const name of await readdir(session.workspaceDir)) {
      const { size } = await diskUsage(
        path.join(session.workspaceDir, name),
        seen,
      );
      if (name === "video-transcodes" || name === "video-quality")
        transcodesBytes += size;
      else if (DERIVED_DIRS.some((directory) => directory === name))
        previewsBytes += size;
      else originalsBytes += size;
    }
    return { originalsBytes, previewsBytes, transcodesBytes };
  };

  clear = async (session: Session, onCleared?: () => void): Promise<void> => {
    await this.pending;
    while (this.evicting.has(session.id)) await this.evicting.get(session.id);
    const entries = [...this.transcodes.values()].filter(
      (entry) => entry.sessionId === session.id,
    );
    if (
      this.active.has(session.id) ||
      this.preparing.has(session.id) ||
      entries.some((entry) =>
        [...entry.renditions.values()].some(
          (rendition) =>
            rendition.status === "queued" ||
            rendition.status === "running" ||
            (rendition.lastAccessedAt &&
              Date.now() - rendition.lastAccessedAt < ACTIVE_PLAYBACK_MS),
        ),
      )
    )
      throw new ApplicationError(
        "CONFLICT",
        "Media is active. Close playback and wait 30 seconds before clearing the cache.",
        409,
      );
    if (this.sessions.get(session.id) !== session)
      throw new ApplicationError("NOT_FOUND", "Session not found.", 404);
    const removal = (async () => {
      for (const directory of DERIVED_DIRS)
        await rm(path.join(session.workspaceDir, directory), {
          recursive: true,
          force: true,
        });
      for (const [key, entry] of this.transcodes)
        if (entry.sessionId === session.id) this.transcodes.delete(key);
      onCleared?.();
    })();
    this.evicting.set(session.id, removal);
    try {
      await removal;
    } finally {
      this.evicting.delete(session.id);
    }
  };

  protectSession = (sessionId: string, allowEviction = false) =>
    protectSession(allowEviction ? this.preparing : this.active, sessionId);
  waitForEviction = (sessionId: string) =>
    this.evicting.get(sessionId) ?? Promise.resolve();
}

export function createDerivedMediaCache(
  sessions: Map<string, Session>,
  transcodes: Map<string, VideoTranscodeEntry>,
  budgetBytes: number,
) {
  return new DerivedMediaCache(sessions, transcodes, budgetBytes);
}
