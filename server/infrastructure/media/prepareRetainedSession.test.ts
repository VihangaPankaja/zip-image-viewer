import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { Session, VideoTranscodeEntry } from "../../domain/models.js";
import { buildTree } from "../../domain/explorerTree.js";
import { prepareRetainedSession } from "./prepareRetainedSession.js";

it("prepares available retained videos after indexing and skips other or unavailable files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "prepare-retained-"));
  try {
    await mkdir(path.join(directory, "season"));
    await writeFile(path.join(directory, "season/episode.mp4"), "video");
    const paths = ["season/episode.mp4", "skipped.mp4", "notes.txt"];
    const session = {
      id: "retained",
      retained: true,
      extractDir: directory,
      tree: buildTree(
        paths.map((relativePath) => ({
          relativePath,
          type: "file",
          size: 1,
          modifiedAt: 0,
        })),
        "collection",
      ).tree,
      availablePaths: new Set([paths[0]]),
    } as Session;
    const prepare = vi
      .fn<Parameters<typeof prepareRetainedSession>[2]>()
      .mockResolvedValue({} as VideoTranscodeEntry);
    const errors = vi.fn();
    await prepareRetainedSession(
      session,
      new Map([[session.id, session]]),
      prepare,
      errors,
    );
    expect(prepare).toHaveBeenCalledExactlyOnceWith(
      session,
      paths[0],
      path.join(directory, paths[0]),
    );
    expect(errors).not.toHaveBeenCalled();
    prepare.mockClear();
    await prepareRetainedSession(session, new Map(), prepare, errors);
    expect(prepare).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
