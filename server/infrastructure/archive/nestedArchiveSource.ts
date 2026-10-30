import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ApplicationError, type Session } from "../../domain/models.js";
import { sanitizeEntryPath } from "../runtime/runtimePrimitives.js";

export async function resolveArchiveSource(parent: Session, relativePath: string) {
  const normalized = sanitizeEntryPath(relativePath);
  if (
    !normalized ||
    normalized !== relativePath.replaceAll("\\", "/") ||
    (parent.availablePaths && !parent.availablePaths.has(normalized))
  )
    throw new ApplicationError("INVALID_INPUT", "Invalid archive path.", 400);
  const root = await realpath(parent.extractDir);
  const filename = await realpath(path.resolve(parent.extractDir, normalized));
  if (!filename.startsWith(`${root}${path.sep}`) || !(await stat(filename)).isFile())
    throw new ApplicationError("INVALID_INPUT", "Archive is outside its owning session.", 400);
  return filename;
}

export async function fingerprintArchive(filename: string, signal: AbortSignal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename, { signal })) hash.update(chunk as Buffer);
  signal.throwIfAborted();
  return hash.digest("hex");
}
