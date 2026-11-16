import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { ExplorerNode, Session } from "../../domain/models.js";
import { ApplicationError } from "../../domain/models.js";
import { validateArchiveEntries } from "../../infrastructure/archive/archiveLimits.js";
import { isWithinRoot } from "../../infrastructure/runtime/filePaths.js";
import { selectionExportInputSchema } from "../../../shared/contracts.js";
import type { ExportEntry } from "../../infrastructure/archive/streamSelectionZip.js";

function selectedNodes(session: Session, paths: string[], signal: AbortSignal) {
  const index = new Map<string, ExplorerNode>();
  const pending = [session.tree];
  let metadataBytes = 0;
  while (pending.length) {
    signal.throwIfAborted();
    const node = pending.pop();
    if (!node) break;
    metadataBytes += Buffer.byteLength(node.path) + 128;
    if (index.size > 10_000 || metadataBytes > 8 * 1024 ** 2)
      throw new ApplicationError("INVALID_INPUT", "Export metadata exceeds its limit.", 413);
    if (index.has(node.path))
      throw new ApplicationError("INVALID_INPUT", "Duplicate export path.", 409);
    index.set(node.path, node);
    for (const child of [...(node.children ?? [])].reverse()) pending.push(child);
  }
  const selected = new Set(paths);
  for (const name of selected) {
    if (!index.has(name))
      throw new ApplicationError("NOT_FOUND", "Selected path is not owned by this session.", 404);
  }
  const nodes = [...index.values()].filter(
    (node) =>
      node.path !== "." &&
      (selected.has(".") ||
        selected.has(node.path) ||
        node.path.split("/").some((_, i, parts) => selected.has(parts.slice(0, i).join("/")))),
  );
  if (!nodes.length)
    throw new ApplicationError("INVALID_INPUT", "Select at least one available entry.", 400);
  return nodes;
}

export async function planSelectionExport(session: Session, paths: string[], signal: AbortSignal) {
  const nodes = selectedNodes(session, paths, signal);
  const entries: ExportEntry[] = [];
  const root = await realpath(session.extractDir);
  for (const node of nodes) {
    signal.throwIfAborted();
    if (!selectionExportInputSchema.safeParse({ paths: [node.path] }).success)
      throw new ApplicationError("INVALID_INPUT", "Unsafe export path.", 400);
    if (node.type === "file" && session.availablePaths && !session.availablePaths.has(node.path))
      throw new ApplicationError(
        "CONFLICT",
        "A selected torrent file is not available yet. Download it first.",
        409,
      );
    const source = path.resolve(session.extractDir, node.path);
    const info = await lstat(source).catch(() => null);
    const actual = await realpath(source).catch(() => "");
    if (
      !info ||
      info.isSymbolicLink() ||
      !isWithinRoot(actual, root) ||
      (node.type === "file" ? !info.isFile() : !info.isDirectory())
    )
      throw new ApplicationError(
        "INVALID_INPUT",
        "Selected source is missing or outside its owning session.",
        400,
      );
    entries.push({
      path: node.path + (node.type === "directory" ? "/" : ""),
      source,
      directory: node.type === "directory",
      size: node.type === "directory" ? 0 : info.size,
      modifiedAt: info.mtimeMs,
      dev: info.dev,
      ino: info.ino,
    });
  }
  let bytes: number;
  try {
    bytes = validateArchiveEntries(entries);
  } catch (error) {
    throw new ApplicationError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : "Invalid selection.",
      413,
    );
  }
  return {
    entries,
    root,
    summary: {
      entries: entries.length,
      bytes,
      requiresConfirmation: bytes >= 512 * 1024 ** 2 || entries.length >= 1000,
    },
  };
}
