import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { archiveVolume } from "../../../shared/archiveVolumes.js";
import { resourceLimitError, assertResourceSize } from "../runtime/resourceLimits.js";
import { ApplicationError } from "../../domain/models.js";

export class ArchiveVolumesRequired extends ApplicationError {
  constructor(readonly missing: string[]) {
    super(
      "INVALID_INPUT",
      `Missing archive volumes: ${missing.join(", ")}. Supply all parts from the same archive before extraction.`,
      409,
    );
    this.name = "ArchiveVolumesRequired";
  }
}

// Resolve only siblings in the owned source directory. Every volume must be a regular file.
export async function resolveArchiveVolumes(filename: string, allowed?: ReadonlySet<string>) {
  const volume = archiveVolume(path.basename(filename));
  if (!volume) return { filename, files: [filename] };
  const directory = path.dirname(filename);
  const names = (await readdir(directory)).filter(
    (name) =>
      archiveVolume(name)?.key.normalize("NFC").toLowerCase() ===
      volume.key.normalize("NFC").toLowerCase(),
  );
  if (names.some((name) => archiveVolume(name)?.key !== volume.key))
    throw resourceLimitError(
      "Windows case or Unicode volume-name collision. Use one consistent spelling for the archive set.",
    );
  const parts = new Map<number, string>();
  const unavailable: string[] = [];
  let bytes = 0;
  const root = await realpath(directory);
  for (const name of names) {
    if (allowed && !allowed.has(name)) {
      unavailable.push(name);
      continue;
    }
    const source = path.join(directory, name);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink() || path.dirname(await realpath(source)) !== root)
      throw resourceLimitError(
        "Archive volumes must be regular files inside their owning source directory.",
      );
    bytes += info.size;
    assertResourceSize(bytes);
    const number = archiveVolume(name)?.number ?? 0;
    if (parts.has(number))
      throw resourceLimitError("Duplicate archive volume numbers. Keep one copy of each part.");
    parts.set(number, name);
  }
  const firstName = [...parts.entries()].sort(([a], [b]) => a - b).at(0)?.[1];
  const canonical = archiveVolume(firstName ?? path.basename(filename)) ?? volume;
  if ([...parts].some(([number, name]) => canonical.name(number) !== name))
    throw resourceLimitError("Use consistent number padding for every archive volume.");
  let count = Math.max(1, ...parts.keys());
  // 7z headers give the complete stream length even when the final part is absent.
  if (/\.7z\.\d+$/i.test(filename) && parts.has(1)) {
    const first = await open(path.join(directory, canonical.first), "r");
    try {
      const header = Buffer.alloc(32);
      const { bytesRead } = await first.read(header, 0, 32, 0);
      if (bytesRead === 32 && header.subarray(0, 6).equals(Buffer.from("377abcaf271c", "hex"))) {
        const required = 32n + header.readBigUInt64LE(12) + header.readBigUInt64LE(20);
        if (required > BigInt(bytes)) {
          const size = (await first.stat()).size;
          count = Math.max(count, Math.ceil(Number(required) / size));
        }
      }
    } finally {
      await first.close();
    }
  }
  if (count > 10_000) throw resourceLimitError("Archive exceeds the 10000-volume limit.");
  const missing = [
    ...new Set([
      ...unavailable,
      ...Array.from({ length: count }, (_, i) => i + 1)
        .filter((number) => !parts.has(number))
        .map(canonical.name),
    ]),
  ];
  if (missing.length) throw new ArchiveVolumesRequired(missing);
  return {
    filename: path.join(directory, canonical.first),
    files: [...parts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, name]) => path.join(directory, name)),
  };
}
