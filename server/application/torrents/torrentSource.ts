import path from "node:path";

export type SourceKind = "http" | "torrent";
export type SourcePreference = "auto" | SourceKind;

const INFO_HASH = /^[a-f\d]{40}$|^[a-z2-7]{32}$/i;

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
    path.isAbsolute(normalized) ||
    (target !== resolvedRoot &&
      !target.startsWith(`${resolvedRoot}${path.sep}`))
  ) {
    throw new Error("Torrent contains an unsafe file path.");
  }
  return target;
}
