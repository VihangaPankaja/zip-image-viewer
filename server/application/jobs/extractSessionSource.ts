import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import unzipper from "unzipper";
import { PROGRESS_EMIT_INTERVAL_MS } from "../../config/runtimeConstants.js";
import type { ExtractedEntry } from "../../domain/explorerTree.js";
import type { SessionJob } from "../../domain/models.js";
import {
  classifyDetectedType,
  isArchiveByName,
} from "../../infrastructure/runtime/mediaClassification.js";
import { sanitizeEntryPath } from "../../infrastructure/runtime/runtimePrimitives.js";

type ExtractDependencies = {
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void;
  detectEncryption: (_archivePath: string) => Promise<boolean>;
  extractWith7zip: (_archivePath: string, _extractDir: string) => Promise<void>;
  listExtractedEntries: (_extractDir: string) => Promise<ExtractedEntry[]>;
};

function createProgress(
  job: SessionJob,
  entries: ExtractedEntry[],
  deps: ExtractDependencies,
) {
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
  archivePath: string,
  extractDir: string,
  entries: ExtractedEntry[],
  progress: (_force?: boolean) => void,
): Promise<void> {
  const root = path.resolve(extractDir);
  const directory = await unzipper.Open.file(archivePath);
  for (const entry of directory.files) {
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
      await pipeline(entry.stream(), createWriteStream(destination));
      entries.push({
        relativePath,
        type: "file",
        size: entry.uncompressedSize,
        modifiedAt: entry.lastModifiedDateTime.getTime(),
      });
    }
    progress();
  }
}

async function moveDirectMedia(
  archivePath: string,
  extractDir: string,
): Promise<ExtractedEntry> {
  const mediaDir = path.join(extractDir, "direct");
  await mkdir(mediaDir, { recursive: true });
  const mediaPath = path.join(mediaDir, path.basename(archivePath));
  await rename(archivePath, mediaPath);
  return {
    relativePath: `direct/${path.basename(archivePath)}`,
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
    return [await moveDirectMedia(archivePath, extractDir)];
  if (await deps.detectEncryption(archivePath)) {
    throw new Error(
      "Password-protected archives are not currently supported in this flow.",
    );
  }
  deps.emitJob(job, {
    status: "extracting",
    phase: "extracting",
    percent: 0,
    message: "Extracting archive",
  });
  const entries: ExtractedEntry[] = [];
  const progress = createProgress(job, entries, deps);
  if (isArchiveByName(archivePath) && !/\.zip$/i.test(archivePath)) {
    await deps.extractWith7zip(archivePath, extractDir);
    entries.push(...(await deps.listExtractedEntries(extractDir)));
  } else {
    await extractZip(archivePath, extractDir, entries, progress);
  }
  progress(true);
  return entries;
}
