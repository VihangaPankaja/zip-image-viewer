import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { resourceLimitError } from "../../infrastructure/runtime/resourceLimits.js";

export type SourceKind = "http" | "torrent";
export type SourcePreference = "auto" | SourceKind;
export const MAX_TORRENT_METADATA_BYTES = 10 * 1024 * 1024;

const INFO_HASH = /^[a-f\d]{40}$|^[a-z2-7]{32}$/i;

export function withoutDirectPeerHints(value: string): string {
  // Persisted magnets may predate submission and HTTP metadata restrictions.
  // Preserve literal BTIH colons required by WebTorrent's magnet parser.
  const queryStart = value.indexOf("?") + 1;
  return (
    value.slice(0, queryStart) +
    value
      .slice(queryStart)
      .split("&")
      .filter((parameter) => {
        const params = new URLSearchParams(parameter);
        return !params.has("x.pe") && !params.has("xs");
      })
      .join("&")
  );
}

function validateMagnet(value: string): void {
  const url = new URL(value);
  const hashes = url.searchParams
    .getAll("xt")
    .filter((item) => item.toLowerCase().startsWith("urn:btih:"))
    .map((item) => item.slice(9));
  if (!hashes.some((hash) => INFO_HASH.test(hash))) {
    throw new Error("Magnet links require a valid BitTorrent info hash.");
  }
}

export function detectSourceKind(
  value: string,
  preference: SourcePreference,
): SourceKind {
  if (value.startsWith("magnet:")) {
    validateMagnet(value);
    if (preference === "http") {
      throw new Error("Magnet links cannot use HTTP Direct mode.");
    }
    return "torrent";
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Use a magnet or public HTTP(S) URL.");
  }
  if (preference !== "auto") return preference;
  return url.pathname.toLowerCase().endsWith(".torrent") ? "torrent" : "http";
}

export function validateTorrentFilePath(
  root: string,
  relativePath: string,
): string {
  const normalized = relativePath.replaceAll("\\", "/");
  const target = path.resolve(root, normalized);
  const resolvedRoot = path.resolve(root);
  if (
    !normalized ||
    normalized.split("/").some((part) => part === "." || part === "..") ||
    normalized.includes(":") ||
    /\p{Cc}/u.test(normalized) ||
    path.isAbsolute(normalized) ||
    !target.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw resourceLimitError("Torrent contains an unsafe file path.");
  }
  if (existsSync(resolvedRoot)) {
    let existing = target;
    while (!existsSync(existing)) existing = path.dirname(existing);
    const realRoot = realpathSync(resolvedRoot);
    const realExisting = realpathSync(existing);
    if (
      realExisting !== realRoot &&
      !realExisting.startsWith(`${realRoot}${path.sep}`)
    )
      throw resourceLimitError("Torrent contains an unsafe file path.");
  }
  return target;
}
