import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ArchiveManifest } from "../../../shared/contracts.js";
import { buildTree } from "../../domain/explorerTree.js";
import { ApplicationError, type Session } from "../../domain/models.js";
import { stageExtraction } from "../../infrastructure/archive/stagedExtraction.js";
import { listExtractedEntries } from "../../infrastructure/archive/listExtractedEntries.js";
import { fingerprintArchive } from "../../infrastructure/archive/nestedArchiveSource.js";
import { extractWith7zip, type inspect7zip } from "../../infrastructure/process/commandRunner.js";

export type NestedArchiveRecord = {
  fingerprint: string;
  manifest: ArchiveManifest;
  index: Awaited<ReturnType<typeof inspect7zip>>;
  childId?: string;
  extracted: Set<string>;
  directory: string;
};
type Selection = {
  parent: Session;
  record: NestedArchiveRecord;
  selected: ArchiveManifest["entries"];
  filename: string;
  signal: AbortSignal;
  track: (_session: Session) => void;
  sessions: Map<string, Session>;
  executable: string;
  bytes: number;
};

function assertOwners(selection: Selection, child?: Session) {
  selection.signal.throwIfAborted();
  if (selection.sessions.get(selection.parent.id) !== selection.parent)
    throw new ApplicationError("NOT_FOUND", "Parent session was deleted.", 404);
  if (child && selection.sessions.get(child.id) !== child)
    throw new ApplicationError("NOT_FOUND", "Child archive was deleted.", 404);
}

async function stageSelection(selection: Selection, pendingDir: string) {
  const { record, signal, filename, selected, executable, bytes } = selection;
  await stageExtraction(pendingDir, async (staging) => {
    await extractWith7zip(executable, filename, staging, {
      signal,
      filePaths: selected.map((entry) => record.index.entries[Number(entry.id)].path),
      index: record.index,
      maxBytes: bytes,
    });
    signal.throwIfAborted();
    if ((await fingerprintArchive(filename, signal)) !== record.fingerprint)
      throw new ApplicationError("CONFLICT", "Archive changed during extraction.", 409);
  });
}

export async function publishNestedSelection(selection: Selection) {
  const { parent, record, selected, sessions, track } = selection;
  const existingChild = record.childId ? sessions.get(record.childId) : undefined;
  if (record.childId && !existingChild) {
    record.childId = undefined;
    record.extracted.clear();
    throw new ApplicationError("NOT_FOUND", "Child archive was deleted.", 404);
  }
  if (existingChild) track(existingChild);
  if (!selected.length && existingChild) return { id: existingChild.id, expandedBytes: 0 };
  const childId = record.childId ?? randomUUID();
  const workspaceDir = path.join(record.directory, childId);
  const extractDir = path.join(workspaceDir, "extracted");
  const pendingDir = path.join(workspaceDir, "pending");
  const moved: string[] = [];
  try {
    assertOwners(selection, existingChild);
    await mkdir(extractDir, { recursive: true });
    await stageSelection(selection, pendingDir);
    assertOwners(selection, existingChild);
    for (const entry of selected) {
      selection.signal.throwIfAborted();
      const destination = path.join(extractDir, entry.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(path.join(pendingDir, entry.path), destination);
      moved.push(destination);
    }
    const output = await listExtractedEntries(extractDir);
    const tree = buildTree(output, path.basename(selection.filename));
    assertOwners(selection, existingChild);
    const child = existingChild ?? {
      id: childId,
      parentSessionId: parent.id,
      workspaceDir,
      extractDir,
      selectedVideoQuality: parent.selectedVideoQuality,
      transcodeStatus: { quality: parent.selectedVideoQuality, done: true, completed: 0, total: 0 },
      lastAccessedAt: Date.now(),
      ...tree,
    };
    Object.assign(child, tree, { lastAccessedAt: Date.now() });
    sessions.set(childId, child);
    record.childId = childId;
    for (const entry of selected) record.extracted.add(entry.id);
    const paths = new Set(selected.map((entry) => entry.path));
    return {
      id: childId,
      expandedBytes: output
        .filter((entry) => paths.has(entry.relativePath))
        .reduce((total, entry) => total + entry.size, 0),
    };
  } catch (error) {
    await Promise.all(moved.map((destination) => rm(destination, { force: true })));
    if (existingChild && sessions.get(childId) !== existingChild) {
      record.childId = undefined;
      record.extracted.clear();
    }
    if (!record.childId) await rm(workspaceDir, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(pendingDir, { recursive: true, force: true });
  }
}
