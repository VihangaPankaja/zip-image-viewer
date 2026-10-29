import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";
import { open, stat, realpath } from "node:fs/promises";
import unzipper from "unzipper";
import type { ArchiveManifest } from "../../../shared/contracts.js";
import { validateArchiveEntries } from "./archiveLimits.js";
import {
  assertResourceEntryCount,
  assertResourceSize,
  resourceLimitError,
} from "../runtime/resourceLimits.js";
import { sanitizeEntryPath } from "../runtime/runtimePrimitives.js";

async function checkDirectorySize(filename: string) {
  const file = await open(filename, "r");
  try {
    const { size } = await file.stat();
    const tail = Buffer.alloc(Math.min(size, 65_557));
    await file.read(tail, 0, tail.length, size - tail.length);
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (
        tail.readUInt32LE(offset) !== 0x06054b50 ||
        offset + 22 + tail.readUInt16LE(offset + 20) !== tail.length
      )
        continue;
      let count = tail.readUInt16LE(offset + 10);
      let bytes = tail.readUInt32LE(offset + 12);
      let start = tail.readUInt32LE(offset + 16);
      if (tail.readUInt16LE(offset + 4) !== 0 || tail.readUInt16LE(offset + 6) !== 0)
        throw resourceLimitError("Multipart ZIP archives are not supported.");
      if (count === 0xffff || bytes === 0xffffffff || start === 0xffffffff) {
        if (offset < 20 || tail.readUInt32LE(offset - 20) !== 0x07064b50)
          throw resourceLimitError("Invalid ZIP64 directory.");
        const position = Number(tail.readBigUInt64LE(offset - 12));
        if (!Number.isSafeInteger(position) || position < 0 || position > size - 56)
          throw resourceLimitError("Invalid ZIP64 directory.");
        const header = Buffer.alloc(56);
        await file.read(header, 0, header.length, position);
        if (header.readUInt32LE(0) !== 0x06064b50)
          throw resourceLimitError("Invalid ZIP64 directory.");
        count = Number(header.readBigUInt64LE(32));
        bytes = Number(header.readBigUInt64LE(40));
        start = Number(header.readBigUInt64LE(48));
      }
      assertResourceEntryCount(count);
      if (!Number.isSafeInteger(bytes) || bytes > 64 * 1024 ** 2)
        throw resourceLimitError("ZIP metadata exceeds the 64 MiB limit.");
      if (!Number.isSafeInteger(start) || start < 0 || start + bytes > size - 22)
        throw resourceLimitError("Invalid ZIP directory bounds.");
      const central = Buffer.alloc(bytes);
      if ((await file.read(central, 0, bytes, start)).bytesRead !== bytes)
        throw resourceLimitError("Truncated ZIP directory.");
      let position = 0;
      for (let index = 0; index < count; index++) {
        if (position + 46 > bytes || central.readUInt32LE(position) !== 0x02014b50)
          throw resourceLimitError("Invalid ZIP directory entry.");
        position +=
          46 +
          central.readUInt16LE(position + 28) +
          central.readUInt16LE(position + 30) +
          central.readUInt16LE(position + 32);
        if (position > bytes) throw resourceLimitError("ZIP metadata exceeds its declared bounds.");
      }
      return 22 + tail.readUInt16LE(offset + 20);
    }
    throw resourceLimitError("Invalid ZIP directory.");
  } finally {
    await file.close();
  }
}

export async function openZip(filename: string) {
  const tailSize = await checkDirectorySize(filename);
  // unzipper supports tailSize, but its published types omit the options argument.
  const openFile: (
    _filename: string,
    _options: { tailSize: number },
  ) => Promise<unzipper.CentralDirectory> = unzipper.Open.file;
  const directory = await openFile(filename, { tailSize });
  validateArchiveEntries(
    directory.files.map((entry) => ({
      path: entry.path,
      size: entry.uncompressedSize,
      isLink: ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000,
    })),
  );
  const names = new Map<string, "file" | "directory">();
  const offsets = new Set<number>();
  const sourceBytes = (await stat(filename)).size;
  let compressedBytes = 0;
  for (const entry of directory.files) {
    assertResourceSize(entry.compressedSize);
    compressedBytes += entry.compressedSize;
    if (
      !Number.isSafeInteger(entry.offsetToLocalFileHeader) ||
      entry.offsetToLocalFileHeader < 0 ||
      entry.offsetToLocalFileHeader + 30 + entry.fileNameLength + entry.compressedSize >
        sourceBytes ||
      compressedBytes > sourceBytes
    )
      throw resourceLimitError("Invalid ZIP entry bounds.");
    const name = sanitizeEntryPath(entry.path);
    const key = name.normalize("NFC").toLowerCase();
    if (
      !name ||
      names.has(key) ||
      offsets.has(entry.offsetToLocalFileHeader) ||
      /(?:^|\/)\.?\.?$/.test(name) ||
      name
        .split("/")
        .some(
          (part) =>
            /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      throw resourceLimitError("Archive contains duplicate or conflicting paths.");
    names.set(key, entry.type === "Directory" ? "directory" : "file");
    offsets.add(entry.offsetToLocalFileHeader);
    if (entry.flags & 1)
      throw resourceLimitError("Password-protected ZIP files are not supported.");
  }
  for (const key of names.keys()) {
    const parts = key.split("/");
    for (let index = 1; index < parts.length; index++) {
      if (names.get(parts.slice(0, index).join("/")) === "file")
        throw resourceLimitError("Archive contains conflicting file and folder paths.");
    }
  }
  return directory;
}

export function zipEntryId(entry: unzipper.File) {
  return String(entry.offsetToLocalFileHeader);
}

export async function inspectZip(filename: string): Promise<ArchiveManifest> {
  const directory = await openZip(filename);
  const sourceBytes = (await stat(filename)).size;
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        sourceBytes,
        directory.files.map((entry) => [
          entry.path,
          entry.offsetToLocalFileHeader,
          entry.compressedSize,
          entry.uncompressedSize,
          entry.crc32,
        ]),
      ]),
    )
    .digest("hex");
  const entries = directory.files.map((entry) => ({
    id: zipEntryId(entry),
    path: sanitizeEntryPath(entry.path),
    type: entry.type === "Directory" ? ("directory" as const) : ("file" as const),
    compressedBytes: entry.compressedSize,
    expandedBytes: entry.uncompressedSize,
    extracted: false,
  }));
  return {
    fingerprint,
    sourceBytes,
    entries,
    compressedBytes: entries.reduce((total, entry) => total + entry.compressedBytes, 0),
    expandedBytes: entries.reduce((total, entry) => total + entry.expandedBytes, 0),
    fileCount: entries.filter((entry) => entry.type === "file").length,
    extractedCount: 0,
  };
}

export async function verifyZipOutput(
  filename: string,
  directory: string,
  selectedIds: readonly string[],
) {
  const archive = await openZip(filename);
  const ids = new Set(selectedIds);
  const root = await realpath(directory);
  for (const entry of archive.files.filter((file) => ids.has(zipEntryId(file)))) {
    const target = path.join(directory, sanitizeEntryPath(entry.path));
    const resolved = await realpath(target);
    if (!resolved.startsWith(`${root}${path.sep}`))
      throw resourceLimitError("Published ZIP file is outside its extraction directory.");
    let checksum = 0;
    let bytes = 0;
    for await (const chunk of createReadStream(target)) {
      bytes += (chunk as Buffer).length;
      if (bytes > entry.uncompressedSize) throw new Error("Published ZIP file has changed.");
      checksum = crc32(chunk as Buffer, checksum);
    }
    if (bytes !== entry.uncompressedSize || checksum !== entry.crc32)
      throw new Error("Published ZIP file failed integrity verification.");
  }
}
