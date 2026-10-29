import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import type { ArchiveManifest, ZipSelection } from "../../../shared/contracts.js";
import { ApplicationError, type SessionJob } from "../../domain/models.js";
import { inspectZip } from "../../infrastructure/archive/zipManifest.js";
import { assertHttpWorkspace } from "../../infrastructure/downloads/httpWorkspace.js";

export class ArchiveSelectionRequired extends Error {}

export async function getArchiveManifest(
  job: SessionJob,
  signal?: AbortSignal,
): Promise<ArchiveManifest> {
  if (!job.archive)
    throw new ApplicationError("CONFLICT", "No ZIP contents are available for this download.", 409);
  await assertHttpWorkspace(job);
  const root = await realpath(job.workspaceDir);
  const source = await realpath(
    job.sourceKind === "http"
      ? job.zipPath
      : path.join(job.workspaceDir, "torrent", job.torrentArchivePath ?? ""),
  );
  if (!source.startsWith(`${root}${path.sep}`))
    throw new ApplicationError(
      "INVALID_INPUT",
      "Archive source is outside its owning workspace.",
      400,
    );
  const manifest = await inspectZip(source, signal);
  if (manifest.fingerprint !== job.archive.fingerprint)
    throw new ApplicationError(
      "CONFLICT",
      "Archive changed. Retry the download to inspect it again.",
      409,
    );
  const extracted = new Set(job.zipSelection?.extractedIds);
  return {
    ...manifest,
    extractedCount: extracted.size,
    entries: manifest.entries.map((entry) => ({ ...entry, extracted: extracted.has(entry.id) })),
  };
}

export async function getZipSelection(
  job: SessionJob,
  fingerprint: string,
  fileIds: string[],
): Promise<ZipSelection> {
  const manifest = await getArchiveManifest(job);
  const known = new Set(
    manifest.entries.filter((entry) => entry.type === "file").map((entry) => entry.id),
  );
  if (
    fingerprint !== manifest.fingerprint ||
    !fileIds.length ||
    new Set(fileIds).size !== fileIds.length ||
    fileIds.some((id) => !known.has(id))
  )
    throw new ApplicationError(
      "INVALID_INPUT",
      "Choose known files from the current ZIP manifest.",
      400,
    );
  const extractedIds = job.zipSelection?.extractedIds ?? [];
  return { fingerprint, selectedIds: [...new Set([...extractedIds, ...fileIds])], extractedIds };
}

export async function prepareZipArchive(
  job: SessionJob,
  source: string,
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void,
): Promise<boolean> {
  const signal = job.abortController?.signal;
  signal?.throwIfAborted();
  const detected = await fileTypeFromFile(source).catch(() => undefined);
  signal?.throwIfAborted();
  if (detected?.ext !== "zip" && !/\.zip$/i.test(source)) return true;
  const indexingStarted = Date.now();
  const manifest = await inspectZip(source, signal);
  job.archiveProcessingMs = (job.archiveProcessingMs ?? 0) + Date.now() - indexingStarted;
  signal?.throwIfAborted();
  const { entries, ...summary } = manifest;
  if (!summary.fileCount) throw new Error("This ZIP contains no files to extract.");
  if (job.zipSelection?.fingerprint === manifest.fingerprint) {
    emitJob(job, { archive: { ...summary, extractedCount: job.zipSelection.extractedIds.length } });
    return true;
  }
  // Older retained libraries already published every entry before selection existed.
  if (job.status === "ready" && job.sessionId) {
    const ids = entries.filter((entry) => entry.type === "file").map((entry) => entry.id);
    emitJob(job, {
      archive: { ...summary, extractedCount: ids.length },
      zipSelection: { fingerprint: manifest.fingerprint, selectedIds: ids, extractedIds: ids },
    });
    return true;
  }
  emitJob(job, {
    archive: summary,
    zipSelection: undefined,
    status: "awaiting_selection",
    phase: "selecting",
    percent: null,
    canPause: false,
    canResume: false,
    message:
      "ZIP contents are ready. Choose files to extract; the source is kept for Extract more.",
  });
  return false;
}
