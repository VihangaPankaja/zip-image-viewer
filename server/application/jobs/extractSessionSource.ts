import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import type { ExtractionProgress } from "../../../shared/contracts.js";
import { createExtractionProgress, startArchiveInspection } from "./extractionProgress.js";
import { extractZip } from "../../infrastructure/archive/extractZip.js";
import type { ExtractedEntry } from "../../domain/explorerTree.js";
import type { SessionJob } from "../../domain/models.js";
import {
  classifyDetectedType,
  isArchiveByName,
} from "../../infrastructure/runtime/mediaClassification.js";
import { reserveStorage } from "../../infrastructure/runtime/resourceLimits.js";

type ExtractDependencies = {
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void;
  detectEncryption: (_archivePath: string, _signal?: AbortSignal) => Promise<boolean>;
  extractWith7zip: (
    _archivePath: string,
    _extractDir: string,
    _signal?: AbortSignal,
    _progress?: (_progress: ExtractionProgress) => void,
  ) => Promise<void>;
  listExtractedEntries: (_extractDir: string) => Promise<ExtractedEntry[]>;
};

async function moveDirectMedia(
  archivePath: string,
  extractDir: string,
  preserveSource: boolean,
  sourceName: string,
): Promise<ExtractedEntry> {
  const mediaDir = path.join(extractDir, "direct");
  await mkdir(mediaDir, { recursive: true });
  const mediaPath = path.join(mediaDir, sourceName);
  if (preserveSource) {
    const storage = reserveStorage(extractDir, (await stat(archivePath)).size);
    try {
      await copyFile(archivePath, mediaPath);
    } finally {
      storage.release();
    }
  } else await rename(archivePath, mediaPath);
  return {
    relativePath: `direct/${sourceName}`,
    type: "file",
    size: (await stat(mediaPath)).size,
    modifiedAt: Date.now(),
  };
}

export async function extractSessionSource(
  job: SessionJob,
  archivePath: string,
  extractDir: string,
  deps: ExtractDependencies,
): Promise<ExtractedEntry[]> {
  const started = Date.now();
  try {
    return await extractSource(job, archivePath, extractDir, deps);
  } finally {
    job.archiveProcessingMs = (job.archiveProcessingMs ?? 0) + Date.now() - started;
  }
}

async function extractSource(
  job: SessionJob,
  archivePath: string,
  extractDir: string,
  deps: ExtractDependencies,
): Promise<ExtractedEntry[]> {
  job.abortController?.signal.throwIfAborted();
  const detected = await fileTypeFromFile(archivePath).catch(() => undefined);
  job.abortController?.signal.throwIfAborted();
  const kind = classifyDetectedType(archivePath, detected);
  if (kind !== "archive")
    return [
      await moveDirectMedia(
        archivePath,
        extractDir,
        !!job.storageRoot,
        job.sourceKind === "http"
          ? path.basename(new URL(job.url).pathname) || "download.bin"
          : path.basename(archivePath),
      ),
    ];
  startArchiveInspection(job, deps.emitJob, "checking");
  if (await deps.detectEncryption(archivePath, job.abortController?.signal)) {
    throw new Error("Password-protected archives are not currently supported in this flow.");
  }
  job.abortController?.signal.throwIfAborted();
  const progress = createExtractionProgress(job, deps.emitJob);
  if (detected?.ext !== "zip" && isArchiveByName(archivePath) && !/\.zip$/i.test(archivePath)) {
    await deps.extractWith7zip(archivePath, extractDir, job.abortController?.signal, progress);
    job.abortController?.signal.throwIfAborted();
    return deps.listExtractedEntries(extractDir);
  }
  return extractZip(
    archivePath,
    extractDir,
    job.zipSelection,
    progress,
    job.abortController?.signal,
  );
}
