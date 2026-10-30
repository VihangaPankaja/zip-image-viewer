import path from "node:path";
import { realpath, rename, stat } from "node:fs/promises";
import type { Session, SessionJob } from "../../domain/models.js";
import type { listExtractedEntries } from "../../infrastructure/archive/listExtractedEntries.js";
import { verifyZipOutput } from "../../infrastructure/archive/zipManifest.js";
import { createSession } from "./processSessionJob.js";
import { getArchiveManifest } from "./archiveSelection.js";
import { torrentSiblingFolder } from "../torrents/torrentSiblingFolder.js";
import { refreshArchiveSession } from "../sessions/refreshArchiveSession.js";

export async function restorePublishedArchiveSession(
  job: SessionJob,
  deps: { sessionStore: Map<string, Session>; listExtractedEntries: typeof listExtractedEntries },
): Promise<void> {
  const existing = deps.sessionStore.get(job.sessionId);
  return refreshArchiveSession(existing, job, async (admit) => {
    const started = Date.now();
    let directory = job.extractDir;
    let paths: Set<string>;
    const source =
      job.sourceKind === "http"
        ? job.zipPath
        : path.join(job.workspaceDir, "torrent", job.torrentArchivePath ?? "");
    if (job.zipSelection?.extractedIds.length) {
      const manifest = await getArchiveManifest(job, job.abortController?.signal);
      const ids = new Set(job.zipSelection.extractedIds);
      const selected = manifest.entries.filter(
        (entry) => entry.type === "file" && ids.has(entry.id),
      );
      if (selected.length !== ids.size) throw new Error("Published ZIP selection is invalid.");
      const previous = `${directory}.previous`;
      if (!(await stat(directory).catch(() => null)) && (await stat(previous).catch(() => null)))
        await rename(previous, directory);
      await verifyZipOutput(source, directory, [...ids], job.abortController?.signal);
      paths = new Set(selected.map((entry) => entry.path));
      if (job.sourceKind === "torrent") {
        const folder = torrentSiblingFolder([...paths]);
        for (const file of job.torrentFiles) {
          if (file.complete && file.selected && file.path !== job.torrentArchivePath)
            paths.add(`${folder}/${file.path}`);
        }
      }
    } else {
      if (job.sourceKind !== "torrent")
        throw new Error("No published archive selection is available.");
      directory = path.join(job.workspaceDir, "torrent");
      paths = new Set(
        job.torrentFiles
          .filter((file) => file.complete && file.selected && file.path !== job.torrentArchivePath)
          .map((file) => file.path),
      );
    }
    if (!(await realpath(directory)).startsWith(`${await realpath(job.workspaceDir)}${path.sep}`))
      throw new Error("Published archive is outside its owning workspace.");
    const entries = (await deps.listExtractedEntries(directory)).filter(
      (entry) => entry.type === "file" && paths.has(entry.relativePath),
    );
    job.archiveProcessingMs = (job.archiveProcessingMs ?? 0) + Date.now() - started;
    admit(entries);
    const session = createSession(job.workspaceDir, directory, source, entries);
    session.id = job.sessionId;
    session.jobId = job.id;
    session.archiveProcessingMs = job.archiveProcessingMs ?? 0;
    session.retained = true;
    deps.sessionStore.set(session.id, existing ? Object.assign(existing, session) : session);
  });
}
