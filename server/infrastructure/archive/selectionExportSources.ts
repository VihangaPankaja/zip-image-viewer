import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { ExplorerNode } from "../../domain/models.js";
import { ApplicationError } from "../../domain/models.js";
import { isWithinRoot } from "../runtime/filePaths.js";
import type { ExportEntry } from "./streamSelectionZip.js";

export async function inspectExportSources(
  directory: string,
  nodes: readonly Pick<ExplorerNode, "path" | "type">[],
  signal: AbortSignal,
) {
  const root = await realpath(directory);
  const entries: ExportEntry[] = [];
  for (const node of nodes) {
    signal.throwIfAborted();
    const source = path.resolve(directory, node.path);
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
  return { entries, root };
}
