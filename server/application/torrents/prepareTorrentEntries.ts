import { copyFile, link, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { SessionJob } from "../../domain/models.js";
import { extractSessionSource } from "../jobs/extractSessionSource.js";

const ARCHIVE_EXTENSION = /\.(zip|rar|7z|tar|gz|tgz)$/i;

export async function prepareTorrentEntries(
  job: SessionJob,
  torrentDir: string,
  extractDir: string,
  deps: Parameters<typeof extractSessionSource>[3],
) {
  const selectedPaths = new Set(
    job.torrentFiles
      .filter((file) => file.selected && file.complete)
      .map((file) => file.path),
  );
  // Shared torrent pieces may also leave partial, unselected files on disk.
  const files = (await deps.listExtractedEntries(torrentDir)).filter(
    (entry) => entry.type === "file" && selectedPaths.has(entry.relativePath),
  );
  const archive = files.find((file) =>
    job.torrentArchivePath
      ? file.relativePath === job.torrentArchivePath
      : ARCHIVE_EXTENSION.test(file.relativePath),
  );
  if (!archive) return { entries: files, sessionDir: torrentDir };
  job.torrentArchivePath = archive.relativePath;
  // Rebuild derived contents so stale siblings cannot enter a 7zip listing.
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  const entries = await extractSessionSource(
    job,
    path.join(torrentDir, archive.relativePath),
    extractDir,
    deps,
  );
  let siblingFolder = "Torrent files";
  while (
    entries.some(
      (entry) =>
        entry.relativePath.split("/")[0]?.toLowerCase() ===
        siblingFolder.toLowerCase(),
    )
  )
    siblingFolder += "-";
  for (const file of files) {
    if (file === archive) continue;
    const relativePath = `${siblingFolder}/${file.relativePath}`;
    const source = path.join(torrentDir, file.relativePath);
    const destination = path.join(extractDir, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await link(source, destination).catch(async (error: unknown) => {
      const code =
        error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "EXDEV" && code !== "EPERM" && code !== "ENOTSUP")
        throw error;
      await copyFile(source, destination);
    });
    entries.push({ ...file, relativePath });
  }
  return { entries, sessionDir: extractDir };
}
