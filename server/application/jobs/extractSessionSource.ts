import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { crc32 } from "node:zlib";
import { fileTypeFromFile } from "file-type";
import { PROGRESS_EMIT_INTERVAL_MS } from "../../config/runtimeConstants.js";
import type { ExtractedEntry } from "../../domain/explorerTree.js";
import type { SessionJob } from "../../domain/models.js";
import {
  classifyDetectedType,
  isArchiveByName,
} from "../../infrastructure/runtime/mediaClassification.js";
import { sanitizeEntryPath } from "../../infrastructure/runtime/runtimePrimitives.js";
import { inspectZip, openZip, zipEntryId } from "../../infrastructure/archive/zipManifest.js";
import { reserveStorage, resourceLimitError } from "../../infrastructure/runtime/resourceLimits.js";

type ExtractDependencies = {
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void;
  detectEncryption: (_archivePath: string) => Promise<boolean>;
  extractWith7zip: (_archivePath: string, _extractDir: string) => Promise<void>;
  listExtractedEntries: (_extractDir: string) => Promise<ExtractedEntry[]>;
};

function createProgress(job: SessionJob, entries: ExtractedEntry[], deps: ExtractDependencies) {
  let lastEmit = Date.now();
  return (force = false): void => {
    const now = Date.now();
    if (!force && now - lastEmit < PROGRESS_EMIT_INTERVAL_MS) return;
    const total = Math.max(1, entries.length);
    deps.emitJob(job, {
      extractedEntries: entries.length,
      totalEntries: total,
      percent: Math.min(100, Math.floor((entries.length / total) * 100)),
      message: `Extracting archive: ${String(entries.length)} of ${String(total)} entries`,
    });
    lastEmit = now;
  };
}

async function extractZip(
  job: SessionJob,
  archivePath: string,
  extractDir: string,
  entries: ExtractedEntry[],
  progress: (_force?: boolean) => void,
): Promise<void> {
  const root = path.resolve(extractDir);
  job.abortController?.signal.throwIfAborted();
  const manifest = await inspectZip(archivePath);
  const selection = job.zipSelection;
  if (selection && selection.fingerprint !== manifest.fingerprint)
    throw new Error("Archive changed. Review its contents again.");
  const selected = selection ? new Set(selection.selectedIds) : null;
  const known = new Set(
    manifest.entries.filter((entry) => entry.type === "file").map((entry) => entry.id),
  );
  if (selected && (!selected.size || [...selected].some((id) => !known.has(id))))
    throw new Error("Invalid archive selection.");
  const directory = await openZip(archivePath);
  const files = directory.files.filter((entry) =>
    selected ? selected.has(zipEntryId(entry)) : true,
  );
  const bytes = files.reduce((total, entry) => total + entry.uncompressedSize, 0);
  const storage = reserveStorage(extractDir, bytes);
  try {
    for (const entry of files) {
      job.abortController?.signal.throwIfAborted();
      const relativePath = sanitizeEntryPath(entry.path);
      const destination = path.join(extractDir, relativePath);
      const resolved = path.resolve(destination);
      if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
        throw new Error("Archive contains invalid file paths.");
      }
      if (entry.type === "Directory") {
        await mkdir(destination, { recursive: true });
        entries.push({
          relativePath,
          type: "directory",
          size: 0,
          modifiedAt: entry.lastModifiedDateTime.getTime(),
        });
      } else {
        await mkdir(path.dirname(destination), { recursive: true });
        let written = 0;
        let checksum = 0;
        const budget = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            try {
              written += chunk.length;
              checksum = crc32(chunk, checksum);
              if (written > entry.uncompressedSize)
                throw resourceLimitError("Archive entry exceeds its declared size.");
              storage.check();
              callback(null, chunk);
            } catch (error) {
              callback(error instanceof Error ? error : new Error(String(error)));
            }
          },
        });
        await pipeline(entry.stream(), budget, createWriteStream(destination, { flags: "wx" }), {
          signal: job.abortController?.signal,
        });
        if (written !== entry.uncompressedSize || checksum !== entry.crc32)
          throw new Error(`Archive entry failed integrity verification: ${relativePath}`);
        entries.push({
          relativePath,
          type: "file",
          size: entry.uncompressedSize,
          modifiedAt: entry.lastModifiedDateTime.getTime(),
        });
      }
      progress();
    }
  } finally {
    storage.release();
  }
}

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
  const detected = await fileTypeFromFile(archivePath).catch(() => undefined);
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
  if (await deps.detectEncryption(archivePath)) {
    throw new Error("Password-protected archives are not currently supported in this flow.");
  }
  deps.emitJob(job, {
    status: "extracting",
    phase: "extracting",
    percent: 0,
    message: "Extracting archive",
  });
  const entries: ExtractedEntry[] = [];
  const progress = createProgress(job, entries, deps);
  if (detected?.ext !== "zip" && isArchiveByName(archivePath) && !/\.zip$/i.test(archivePath)) {
    await deps.extractWith7zip(archivePath, extractDir);
    entries.push(...(await deps.listExtractedEntries(extractDir)));
  } else {
    await extractZip(job, archivePath, extractDir, entries, progress);
  }
  progress(true);
  return entries;
}
