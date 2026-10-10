import path from "node:path";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { detectSourceKind, validateTorrentFilePath } from "./torrentSource.js";
import {
  fetchTorrentMetadata,
  MAX_TORRENT_METADATA_BYTES,
} from "./torrentDownloader.js";

const magnet =
  "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=fixture";

it("rejects torrent write paths through a junction owned by another session", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "torrent-path-owner-"));
  try {
    const root = path.join(directory, "owner");
    const other = path.join(directory, "other");
    await mkdir(root);
    await mkdir(other);
    await symlink(other, path.join(root, "linked"), "junction");
    expect(() => validateTorrentFilePath(root, "linked/private.txt")).toThrow(
      "unsafe file path",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

  it.each([
    ".",
    "folder/..",
    "C:/outside.txt",
    "folder/../../outside.txt",
    "folder/../inside.txt",
    "file\u0000.txt",
    "folder/file:stream",
  ])("rejects ambiguous torrent paths (%s)", (relativePath) => {
    expect(() =>
      validateTorrentFilePath(path.resolve("downloads"), relativePath),
    ).toThrow("unsafe file path");
  });
});
