import type { ArchiveManifest } from "../../../../shared/contracts";

export function archiveFiles(manifest: ArchiveManifest) {
  return manifest.entries
    .filter((entry) => entry.type === "file")
    .map((entry) => ({ ...entry, size: entry.expandedBytes }));
}

export function changeArchiveSelection(
  current: Set<string>,
  entries: { id: string }[],
  checked: boolean,
): Set<string> {
  const next = new Set(current);
  for (const entry of entries) {
    if (checked) next.add(entry.id);
    else next.delete(entry.id);
  }
  return next;
}
