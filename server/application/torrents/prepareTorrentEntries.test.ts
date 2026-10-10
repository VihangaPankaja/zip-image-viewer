import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { createJobManager } from "../jobs/jobManager.js";
import { listExtractedEntries } from "../../infrastructure/archive/listExtractedEntries.js";
import { prepareTorrentEntries } from "./prepareTorrentEntries.js";

it("keeps the live extraction after rebuild failure and recovers interrupted swaps", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "torrent-extraction-"));
  const torrentDir = path.join(workspace, "torrent");
  const extractDir = path.join(workspace, "extracted");
  const previous = `${extractDir}.previous`;
  const staging = `${extractDir}.staging`;
  try {
    await mkdir(torrentDir);
    await mkdir(extractDir);
    await writeFile(path.join(extractDir, "notes.txt"), "original notes");
    await writeFile(path.join(torrentDir, "archive.7z"), "archive");
    await writeFile(path.join(torrentDir, "sibling.txt"), "added sibling");
    const job = createJobManager(new Map(), vi.fn()).createJob(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    );
    job.workspaceDir = workspace;
    job.torrentFiles = ["archive.7z", "sibling.txt"].map((file, index) => ({
      id: String(index),
      path: file,
      size: 1,
      selected: true,
      complete: true,
      downloadedBytes: 1,
    }));
    const extractWith7zip = vi.fn(
      async (_archive: string, destination: string): Promise<void> => {
        expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe(
          "original notes",
        );
        await writeFile(
          path.join(destination, "partial.txt"),
          "partial extraction",
        );
        throw new Error("7zip failed");
      },
    );
    const deps = {
      emitJob: vi.fn(),
      detectEncryption: () => Promise.resolve(false),
      extractWith7zip,
      listExtractedEntries,
      logEvent: vi.fn(),
    };
    await expect(
      prepareTorrentEntries(job, torrentDir, extractDir, deps),
    ).rejects.toThrow("7zip failed");
    expect(await readdir(extractDir)).toEqual(["notes.txt"]);
    expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe(
      "original notes",
    );
    await rename(extractDir, previous);
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "interrupted.txt"), "interrupted build");
    await expect(
      prepareTorrentEntries(job, torrentDir, extractDir, deps),
    ).rejects.toThrow("7zip failed");
    expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe(
      "original notes",
    );
    extractWith7zip.mockImplementation(async (_archive, destination) => {
      await writeFile(path.join(destination, "notes.txt"), "original notes");
    });
    const rebuilt = await prepareTorrentEntries(
      job,
      torrentDir,
      extractDir,
      deps,
    );
    expect(rebuilt.entries.map((entry) => entry.relativePath)).toContain(
      "Torrent files/sibling.txt",
    );
    expect(
      await readFile(
        path.join(extractDir, "Torrent files", "sibling.txt"),
        "utf8",
      ),
    ).toBe("added sibling");
    await mkdir(previous);
    await writeFile(path.join(previous, "stale.txt"), "previous build");
    await mkdir(staging);
    await writeFile(
      path.join(staging, "interrupted.txt"),
      "interrupted cleanup",
    );
    await prepareTorrentEntries(job, torrentDir, extractDir, deps);
    expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe(
      "original notes",
    );
    expect(await readFile(path.join(torrentDir, "sibling.txt"), "utf8")).toBe(
      "added sibling",
    );
    expect((await readdir(workspace)).sort()).toEqual(["extracted", "torrent"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
