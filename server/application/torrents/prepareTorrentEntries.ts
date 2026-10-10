import { existsSync } from "node:fs";
import { copyFile, link, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { SessionJob } from "../../domain/models.js";
import { extractSessionSource } from "../jobs/extractSessionSource.js";

const ARCHIVE_EXTENSION = /\.(zip|rar|7z|tar|gz|tgz)$/i;

type EntryDependencies = Parameters<typeof extractSessionSource>[3] & {
  logEvent: (
    _level: "warn",
    _event: string,
    _details: Record<string, unknown>,
  ) => void;
};

async function cleanupDerived(
  directory: string,
  job: SessionJob,
  deps: EntryDependencies,
) {
  await rm(directory, { recursive: true, force: true }).catch(
    (error: unknown) => {
      deps.logEvent("warn", "torrent.extraction.cleanup.failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  );
}

export async function prepareTorrentEntries(
  job: SessionJob,
  torrentDir: string,
  extractDir: string,
  deps: EntryDependencies,
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
  if (path.resolve(extractDir) !== path.resolve(job.workspaceDir, "extracted"))
    throw new Error("Invalid retained extraction directory.");
  job.torrentArchivePath = archive.relativePath;
  const staging = `${extractDir}.staging`;
  const previous = `${extractDir}.previous`;
  if (existsSync(previous)) {
    if (existsSync(extractDir))
      await rm(previous, { recursive: true, force: true });
    else await rename(previous, extractDir);
  }
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const entries = await extractSessionSource(
      job,
      path.join(torrentDir, archive.relativePath),
      staging,
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
      const destination = path.join(staging, relativePath);
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
    const hadPrevious = existsSync(extractDir);
    if (hadPrevious) await rename(extractDir, previous);
    try {
      await rename(staging, extractDir);
    } catch (error) {
      if (hadPrevious) await rename(previous, extractDir);
      throw error;
    }
    await cleanupDerived(previous, job, deps);
    return { entries, sessionDir: extractDir };
  } finally {
    await cleanupDerived(staging, job, deps);
  }
}
