import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ExtractedEntry } from "../../domain/explorerTree.js";

export async function listExtractedEntries(
  rootDir: string,
  currentDir = rootDir,
  entries: ExtractedEntry[] = [],
): Promise<ExtractedEntry[]> {
  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path
      .relative(rootDir, fullPath)
      .split(path.sep)
      .join("/");
    const details = await stat(fullPath);
    if (entry.isDirectory()) {
      entries.push({
        relativePath,
        type: "directory",
        size: 0,
        modifiedAt: details.mtimeMs,
      });
      await listExtractedEntries(rootDir, fullPath, entries);
    } else if (entry.isFile()) {
      entries.push({
        relativePath,
        type: "file",
        size: details.size,
        modifiedAt: details.mtimeMs,
      });
    }
  }
  return entries;
}
