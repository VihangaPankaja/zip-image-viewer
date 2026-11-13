import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { crc32 } from "node:zlib";
import type { ExtractionProgress, ZipSelection } from "../../../shared/contracts.js";
import type { ExtractedEntry } from "../../domain/explorerTree.js";
import { sanitizeEntryPath } from "../runtime/runtimePrimitives.js";
import { inspectZip, openZip, zipEntryId } from "./zipManifest.js";
import { reserveStorage, resourceLimitError } from "../runtime/resourceLimits.js";

async function writeEntry(
  entry: Awaited<ReturnType<typeof openZip>>["files"][number],
  destination: string,
  storage: ReturnType<typeof reserveStorage>,
  onBytes: (_bytes: number) => void,
  signal?: AbortSignal,
) {
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
        onBytes(chunk.length);
        callback(null, chunk);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
  await pipeline(entry.stream(), budget, createWriteStream(destination, { flags: "wx" }), {
    signal,
  });
  signal?.throwIfAborted();
  if (written !== entry.uncompressedSize || checksum !== entry.crc32)
    throw new Error(`Archive entry failed integrity verification: ${entry.path}`);
}

export async function extractZip(
  archivePath: string,
  extractDir: string,
  selection: ZipSelection | undefined,
  report: (_progress: ExtractionProgress) => void,
  signal?: AbortSignal,
): Promise<ExtractedEntry[]> {
  const root = path.resolve(extractDir);
  signal?.throwIfAborted();
  const manifest = await inspectZip(archivePath, signal);
  if (selection && selection.fingerprint !== manifest.fingerprint)
    throw new Error("Archive changed. Review its contents again.");
  const selected = selection ? new Set(selection.selectedIds) : null;
  const known = new Set(
    manifest.entries.filter((entry) => entry.type === "file").map((entry) => entry.id),
  );
  if (selected && (!selected.size || [...selected].some((id) => !known.has(id))))
    throw new Error("Invalid archive selection.");
  const directory = await openZip(archivePath, signal);
  const files = directory.files.filter((entry) =>
    selected ? selected.has(zipEntryId(entry)) : true,
  );
  const progress: ExtractionProgress = {
    stage: "extracting",
    completedEntries: 0,
    totalEntries: files.filter((entry) => entry.type !== "Directory").length,
    expandedBytes: 0,
    totalExpandedBytes: files.reduce((total, entry) => total + entry.uncompressedSize, 0),
    currentEntry: "",
  };
  report(progress);
  const storage = reserveStorage(extractDir, progress.totalExpandedBytes ?? 0);
  const entries: ExtractedEntry[] = [];
  try {
    for (const entry of files) {
      signal?.throwIfAborted();
      const relativePath = sanitizeEntryPath(entry.path);
      const destination = path.join(extractDir, relativePath);
      const resolved = path.resolve(destination);
      if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root)
        throw new Error("Archive contains invalid file paths.");
      if (entry.type === "Directory") await mkdir(destination, { recursive: true });
      else {
        progress.currentEntry = relativePath;
        report(progress);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeEntry(
          entry,
          destination,
          storage,
          (bytes) => {
            progress.expandedBytes += bytes;
            report(progress);
          },
          signal,
        );
        progress.completedEntries++;
        report(progress);
      }
      entries.push({
        relativePath,
        type: entry.type === "Directory" ? "directory" : "file",
        size: entry.uncompressedSize,
        modifiedAt: entry.lastModifiedDateTime.getTime(),
      });
    }
    report({ ...progress, stage: "publishing", currentEntry: "" });
    return entries;
  } finally {
    storage.release();
  }
}
