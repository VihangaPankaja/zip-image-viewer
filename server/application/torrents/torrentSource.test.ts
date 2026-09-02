import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectSourceKind, validateTorrentFilePath } from "./torrentSource.js";
import {
  fetchTorrentMetadata,
  MAX_TORRENT_METADATA_BYTES,
} from "./torrentDownloader.js";

const magnet =
  "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=fixture";

describe("torrent source validation", () => {
  it("detects magnets and .torrent URLs while allowing an explicit override", () => {
    expect(detectSourceKind(magnet, "auto")).toBe("torrent");
    expect(detectSourceKind("https://example.com/file.torrent", "auto")).toBe(
      "torrent",
    );
    expect(detectSourceKind("https://example.com/download", "torrent")).toBe(
      "torrent",
    );
    expect(detectSourceKind("https://example.com/download", "http")).toBe(
      "http",
    );
  });

  it("rejects malformed info hashes and path traversal", () => {
    expect(() => detectSourceKind("magnet:?xt=urn:btih:nope", "auto")).toThrow(
      "valid BitTorrent info hash",
    );
    const root = path.resolve("downloads");
    expect(validateTorrentFilePath(root, "folder/image.jpg")).toBe(
      path.join(root, "folder", "image.jpg"),
    );
    expect(() => validateTorrentFilePath(root, "../escape.jpg")).toThrow(
      "unsafe file path",
    );
  });

  it("caps remote torrent metadata at 10 MiB", async () => {
    const oversized = new Response(new Uint8Array(1), {
      headers: {
        "content-length": String(MAX_TORRENT_METADATA_BYTES + 1),
      },
    });
    await expect(
      fetchTorrentMetadata(
        "https://example.com/file.torrent",
        new AbortController().signal,
        () => Promise.resolve(oversized),
      ),
    ).rejects.toThrow("10 MiB");
  });
});
