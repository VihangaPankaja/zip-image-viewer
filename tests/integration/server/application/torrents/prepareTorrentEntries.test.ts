import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";
import { prepareTorrentEntries } from "../../../../../server/application/torrents/prepareTorrentEntries.js";
import { path7za } from "7zip-bin";
import {
  runCommand,
  detectArchiveEncryption,
} from "../../../../../server/infrastructure/process/commandRunner.js";
import { extractRuntimeArchive } from "../../../../../server/runtimeAdapters.js";

it("extracts a completed multipart torrent set once and never reads an unverified sibling part", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "torrent-volumes-"));
  try {
    const torrent = path.join(root, "torrent");
    const input = path.join(root, "input");
    await mkdir(torrent);
    await mkdir(input);
    await writeFile(path.join(input, "日本語.txt"), Buffer.alloc(2048, 65));
    await runCommand(path7za, ["a", "-t7z", "-mx=0", "-v1k", path.join(torrent, "book.7z"), "."], {
      cwd: input,
    });
    await writeFile(path.join(torrent, "sibling.txt"), "kept sibling");
    const job = createJobManager(new Map(), vi.fn()).createJob(
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
    );
    job.workspaceDir = root;
    job.abortController = new AbortController();
    job.torrentFiles = (await listExtractedEntries(torrent))
      .filter((entry) => entry.type === "file")
      .reverse()
      .map((entry, i) => ({
        id: String(i),
        path: entry.relativePath,
        size: entry.size,
        selected: true,
        complete: true,
        downloadedBytes: entry.size,
      }));
    const deps: Parameters<typeof prepareTorrentEntries>[3] = {
      emitJob: (current: typeof job, patch: Partial<typeof job>) => Object.assign(current, patch),
      detectEncryption: (source: string, signal?: AbortSignal) =>
        detectArchiveEncryption(path7za, source, signal),
      extractWith7zip: (source, output, signal, progress, secrets) =>
        extractRuntimeArchive(path7za, source, output, signal, progress, secrets),
      listExtractedEntries,
      logEvent: vi.fn(),
    };
    const output = path.join(root, "extracted");
    const result = await prepareTorrentEntries(job, torrent, output, deps);
    expect(job.torrentArchivePath).toBe("book.7z.001");
    expect(result.entries.some((entry) => /\.7z\.\d+$/.test(entry.relativePath))).toBe(false);
    expect((await readFile(path.join(output, "日本語.txt"))).length).toBe(2048);
    expect(result.entries.some((entry) => entry.relativePath.endsWith("/sibling.txt"))).toBe(true);
    const last = job.torrentFiles.find((file) => file.path === "book.7z.003");
    if (!last) throw new Error("Missing final fixture volume");
    last.complete = false;
    await expect(prepareTorrentEntries(job, torrent, output, deps)).rejects.toThrow(
      /Missing archive volumes/,
    );
    expect((await readFile(path.join(output, "日本語.txt"))).length).toBe(2048);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    const extractWith7zip = vi.fn(async (_archive: string, destination: string): Promise<void> => {
      expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe("original notes");
      await writeFile(path.join(destination, "partial.txt"), "partial extraction");
      throw new Error("7zip failed");
    });
    const deps = {
      emitJob: vi.fn(),
      detectEncryption: () => Promise.resolve(false),
      extractWith7zip,
      listExtractedEntries,
      logEvent: vi.fn(),
    };
    await expect(prepareTorrentEntries(job, torrentDir, extractDir, deps)).rejects.toThrow(
      "7zip failed",
    );
    expect(await readdir(extractDir)).toEqual(["notes.txt"]);
    expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe("original notes");
    await rename(extractDir, previous);
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "interrupted.txt"), "interrupted build");
    await expect(prepareTorrentEntries(job, torrentDir, extractDir, deps)).rejects.toThrow(
      "7zip failed",
    );
    expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe("original notes");
    extractWith7zip.mockImplementation(async (_archive, destination) => {
      await writeFile(path.join(destination, "notes.txt"), "original notes");
    });
    const rebuilt = await prepareTorrentEntries(job, torrentDir, extractDir, deps);
    expect(rebuilt.entries.map((entry) => entry.relativePath)).toContain(
      "Torrent files/sibling.txt",
    );
    expect(await readFile(path.join(extractDir, "Torrent files", "sibling.txt"), "utf8")).toBe(
      "added sibling",
    );
    await mkdir(previous);
    await writeFile(path.join(previous, "stale.txt"), "previous build");
    await mkdir(staging);
    await writeFile(path.join(staging, "interrupted.txt"), "interrupted cleanup");
    await prepareTorrentEntries(job, torrentDir, extractDir, deps);
    expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe("original notes");
    expect(await readFile(path.join(torrentDir, "sibling.txt"), "utf8")).toBe("added sibling");
    expect((await readdir(workspace)).sort()).toEqual(["extracted", "torrent"]);
    job.abortController = new AbortController();
    extractWith7zip.mockImplementation(async (_archive, destination) => {
      await writeFile(path.join(destination, "notes.txt"), "cancelled replacement");
      job.abortController?.abort();
    });
    await expect(prepareTorrentEntries(job, torrentDir, extractDir, deps)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(await readFile(path.join(extractDir, "notes.txt"), "utf8")).toBe("original notes");
    expect((await readdir(workspace)).sort()).toEqual(["extracted", "torrent"]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
