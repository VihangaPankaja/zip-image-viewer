import path from "node:path";
import type { Session, VideoTranscodeEntry } from "../../domain/models.js";
import { VIDEO_EXTENSIONS } from "../runtime/mediaClassification.js";
import { sanitizeEntryPath } from "../runtime/runtimePrimitives.js";
import { isRealPathWithinRoot } from "../runtime/filePaths.js";

export async function prepareRetainedSession(
  session: Session,
  sessions: ReadonlyMap<string, Session>,
  prepare: (
    _session: Session,
    _path: string,
    _target: string,
  ) => Promise<VideoTranscodeEntry>,
  onError: (_error: unknown) => void,
): Promise<void> {
  const pending = [session.tree];
  while (pending.length && sessions.get(session.id) === session) {
    const node = pending.pop();
    if (!node) break;
    if (node.type === "directory") {
      pending.push(...(node.children ?? []));
      continue;
    }
    if (!VIDEO_EXTENSIONS.has(path.extname(node.path).slice(1).toLowerCase()))
      continue;
    try {
      const normalizedPath = sanitizeEntryPath(node.path);
      if (session.availablePaths && !session.availablePaths.has(normalizedPath))
        continue;
      const target = path.resolve(session.extractDir, normalizedPath);
      if (!(await isRealPathWithinRoot(target, session.extractDir)))
        throw new Error("Invalid retained video path.");
      await prepare(session, normalizedPath, target);
    } catch (error) {
      onError(error);
    }
  }
}
