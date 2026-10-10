import path from "node:path";
import {
  assertResourceEntryCount,
  assertResourceSize,
  resourceLimitError,
} from "../runtime/resourceLimits.js";
import { sanitizeEntryPath } from "../runtime/runtimePrimitives.js";

export function validateArchiveEntries(
  entries: { path: string; size: number; isLink?: boolean }[],
): number {
  assertResourceEntryCount(entries.length);
  let bytes = 0;
  for (const entry of entries) {
    const name = entry.path.replaceAll("\\", "/");
    if (
      path.posix.isAbsolute(name) ||
      name.includes(":") ||
      /\p{Cc}/u.test(name) ||
      name.split("/").some((part) => part === "..")
    )
      throw resourceLimitError(`Unsafe entry path: ${entry.path}`);
    sanitizeEntryPath(name);
    if (entry.isLink)
      throw resourceLimitError("Archive links are not supported.");
    assertResourceSize(entry.size);
    bytes += entry.size;
    assertResourceSize(bytes);
  }
  return bytes;
}
