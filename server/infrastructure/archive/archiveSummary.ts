import type { ArchiveManifest } from "../../../shared/contracts.js";

export function summarizeArchive(entries: ArchiveManifest["entries"]) {
  return {
    compressedBytes: entries.reduce((total, entry) => total + entry.compressedBytes, 0),
    expandedBytes: entries.reduce((total, entry) => total + entry.expandedBytes, 0),
    fileCount: entries.filter((entry) => entry.type === "file").length,
    extractedCount: entries.filter((entry) => entry.type === "file" && entry.extracted).length,
  };
}
