import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { listExtractedEntries } from "./listExtractedEntries.js";

it("rejects filesystem links instead of indexing another session's directory", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "index-path-owner-"));
  try {
    const root = path.join(directory, "owner");
    const other = path.join(directory, "other");
    await mkdir(root);
    await mkdir(other);
    await symlink(other, path.join(root, "linked"), "junction");
    await expect(listExtractedEntries(root)).rejects.toThrow("links");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
