import type { ExplorerNode, Session } from "../../domain/models.js";
import { ApplicationError } from "../../domain/models.js";
import { validateArchiveEntries } from "../../infrastructure/archive/archiveLimits.js";
import { selectionExportInputSchema } from "../../../shared/contracts.js";
import { inspectExportSources } from "../../infrastructure/archive/selectionExportSources.js";

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
  }
  const { entries, root } = await inspectExportSources(session.extractDir, nodes, signal);
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
