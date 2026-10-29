import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { inspectZip } from "../../../../../server/infrastructure/archive/zipManifest.js";
import { extractSessionSource } from "../../../../../server/application/jobs/extractSessionSource.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";
import { runCommand } from "../../../../../server/infrastructure/process/commandRunner.js";
import {
  getArchiveManifest,
  prepareZipArchive,
} from "../../../../../server/application/jobs/archiveSelection.js";
import { createSessionJobQueue } from "../../../../../server/application/jobs/sessionJobQueue.js";
import { stageExtraction } from "../../../../../server/infrastructure/archive/stagedExtraction.js";
import { zipBytes } from "../../../../fixtures/zipBytes.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "zip-selection-"));
  directories.push(root);
  const source = path.join(root, "source");
  const output = path.join(root, "extracted");
  await mkdir(path.join(source, "album"), { recursive: true });
  await mkdir(output);
  await writeFile(path.join(source, "album", "one.txt"), "first file");
  await writeFile(path.join(source, "album", "two.txt"), "second file");
  await writeFile(path.join(source, "skip.txt"), "leave compressed");
  const archive = path.join(root, "fixture.zip");
  await runCommand(path7za, ["a", "-tzip", archive, "."], { cwd: source });
  const manager = createJobManager(new Map(), vi.fn());
  const job = manager.createJob("https://example.com/fixture.zip");
  Object.assign(job, { workspaceDir: root, zipPath: archive, extractDir: output });
  const deps = {
    emitJob: manager.emitJob,
    detectEncryption: () => Promise.resolve(false),
    extractWith7zip: vi.fn(),
    listExtractedEntries,
  };
  return { root, source, output, archive, job, deps };
}

it("indexes a ZIP without extracting and gives stable IDs, compressed sizes and expanded sizes", async () => {
  const { archive, output } = await fixture();
  const first = await inspectZip(archive);
  expect(await inspectZip(archive)).toEqual(first);
  expect(first.entries.filter((entry) => entry.type === "file")).toHaveLength(3);
  expect(first.entries.find((entry) => entry.path === "album/one.txt")).toMatchObject({
    expandedBytes: 10,
  });
  expect(first.sourceBytes).toBeGreaterThan(0);
  expect(first.expandedBytes).toBe(37);
  expect(await readdir(output)).toEqual([]);
});

it("streams only selected ZIP entries and preserves the source for another selection", async () => {
  const { archive, output, job, deps } = await fixture();
  const manifest = await inspectZip(archive);
  const chosen = manifest.entries.filter(
    (entry) => entry.path.startsWith("album/") && entry.type === "file",
  );
  job.zipSelection = {
    fingerprint: manifest.fingerprint,
    selectedIds: chosen.map((entry) => entry.id),
    extractedIds: [],
  };
  const original = await readFile(archive);
  const entries = await extractSessionSource(job, archive, output, deps);
  expect(
    entries
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.relativePath)
      .sort(),
  ).toEqual(["album/one.txt", "album/two.txt"]);
  expect(await readFile(path.join(output, "album", "one.txt"), "utf8")).toBe("first file");
  expect(await readFile(path.join(output, "album", "two.txt"), "utf8")).toBe("second file");
  expect(await readdir(output)).toEqual(["album"]);
  expect(await readFile(archive)).toEqual(original);
});

it("rejects stale or unknown selection IDs before writing output", async () => {
  const { archive, output, job, deps } = await fixture();
  const manifest = await inspectZip(archive);
  job.zipSelection = {
    fingerprint: manifest.fingerprint,
    selectedIds: ["unknown"],
    extractedIds: [],
  };
  await expect(extractSessionSource(job, archive, output, deps)).rejects.toThrow(/selection/i);
  expect(await readdir(output)).toEqual([]);
  job.zipSelection.fingerprint = "0".repeat(64);
  await expect(extractSessionSource(job, archive, output, deps)).rejects.toThrow(/changed/i);
});

it("honors an already cancelled extraction before writing any entry", async () => {
  const { archive, output, job, deps } = await fixture();
  job.abortController = new AbortController();
  job.abortController.abort();
  await expect(extractSessionSource(job, archive, output, deps)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(await readdir(output)).toEqual([]);
});

it("inspects and extracts a ZIP with a long archive comment", async () => {
  const { archive, output, job, deps } = await fixture();
  const bytes = await readFile(archive);
  const comment = Buffer.from("A ZIP comment. ".repeat(100));
  bytes.writeUInt16LE(comment.length, bytes.length - 2);
  await writeFile(archive, Buffer.concat([bytes, comment]));
  expect((await inspectZip(archive)).fileCount).toBe(3);
  await extractSessionSource(job, archive, output, deps);
  expect(await readFile(path.join(output, "skip.txt"), "utf8")).toBe("leave compressed");
});

it("bounds actual directory records before parsing variable ZIP metadata", async () => {
  const { archive } = await fixture();
  const bytes = await readFile(archive);
  bytes.writeUInt32LE(46, bytes.length - 10);
  await writeFile(archive, bytes);
  await expect(inspectZip(archive)).rejects.toThrow(/bounds|directory entry/);
});

it.each([3, 10_001])(
  "uses ZIP64 counts when only the directory offset is marked ZIP64 (%s)",
  async (count) => {
    const { archive } = await fixture();
    const bytes = zipBytes(
      Array.from({ length: 3 }, (_, index) => ({
        name: `${index}.txt`,
        data: Buffer.from("file"),
      })),
    );
    const end = Buffer.from(bytes.subarray(-22));
    const directoryBytes = end.readUInt32LE(12);
    const directoryStart = end.readUInt32LE(16);
    const zip64 = Buffer.alloc(56);
    zip64.writeUInt32LE(0x06064b50);
    zip64.writeBigUInt64LE(44n, 4);
    zip64.writeBigUInt64LE(BigInt(count), 24);
    zip64.writeBigUInt64LE(BigInt(count), 32);
    zip64.writeBigUInt64LE(BigInt(directoryBytes), 40);
    zip64.writeBigUInt64LE(BigInt(directoryStart), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50);
    locator.writeBigUInt64LE(BigInt(bytes.length - 22), 8);
    locator.writeUInt32LE(1, 16);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(1, 12);
    end.writeUInt32LE(0xffffffff, 16);
    await writeFile(archive, Buffer.concat([bytes.subarray(0, -22), zip64, locator, end]));
    if (count > 10_000) await expect(inspectZip(archive)).rejects.toThrow("10000");
    else expect((await inspectZip(archive)).fileCount).toBe(3);
  },
);

it("reviews before extraction and adds skipped entries without losing the earlier selection", async () => {
  const { archive, output, job, deps } = await fixture();
  expect(await prepareZipArchive(job, archive, deps.emitJob)).toBe(false);
  expect(job.status).toBe("awaiting_selection");
  expect(await readdir(output)).toEqual([]);
  const manifest = await getArchiveManifest(job);
  const first = manifest.entries.find((entry) => entry.path === "album/one.txt");
  const next = manifest.entries.find((entry) => entry.path === "skip.txt");
  if (!first || !next) throw new Error("Fixture entries are missing");
  const queue = createSessionJobQueue({
    initialJobs: [job],
    pendingSessionJobs: [],
    maxActiveSessionJobs: 1,
    getActiveSessionJobCount: () => 1,
    incrementActiveSessionJobCount: vi.fn(),
    decrementActiveSessionJobCount: vi.fn(),
    processSessionJob: vi.fn(),
    emitJob: deps.emitJob,
    logEvent: vi.fn(),
  });
  await expect(queue.selectArchiveFiles(job.id, manifest.fingerprint, ["missing"])).rejects.toThrow(
    /known files/,
  );
  await queue.selectArchiveFiles(job.id, manifest.fingerprint, [first.id]);
  await expect(queue.selectArchiveFiles(job.id, manifest.fingerprint, [next.id])).rejects.toThrow(
    /finish/,
  );
  await stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps));
  expect(await readdir(output)).toEqual(["album"]);
  if (!job.zipSelection) throw new Error("Archive selection is missing");
  job.zipSelection.extractedIds = [first.id];
  job.status = "ready";
  expect(
    (await getArchiveManifest(job)).entries.find((entry) => entry.id === first.id)?.extracted,
  ).toBe(true);
  await queue.selectArchiveFiles(job.id, manifest.fingerprint, [next.id]);
  expect(job.zipSelection.selectedIds).toEqual([first.id, next.id]);
  await stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps));
  expect(await readFile(path.join(output, "album", "one.txt"), "utf8")).toBe("first file");
  expect(await readFile(path.join(output, "skip.txt"), "utf8")).toBe("leave compressed");
  expect(await readdir(path.join(output, "album"))).toEqual(["one.txt"]);
});

it.each(["ENOSPC", "AbortError"])(
  "does not publish partial entries when staging fails with %s",
  async (code) => {
    const { archive, output, root, job, deps } = await fixture();
    await writeFile(path.join(output, "previous.txt"), "existing library");
    await expect(
      stageExtraction(output, async (staging) => {
        await extractSessionSource(job, archive, staging, deps);
        throw Object.assign(new Error(code), { code, name: code });
      }),
    ).rejects.toThrow(code);
    expect(await readdir(output)).toEqual(["previous.txt"]);
    expect(await readFile(path.join(output, "previous.txt"), "utf8")).toBe("existing library");
    expect(await readdir(root)).not.toContain("extracted.staging");
    expect(await readFile(archive)).not.toHaveLength(0);
  },
);

it("indexes ten thousand files without extracting any payload", async () => {
  const { root, output } = await fixture();
  const archive = path.join(root, "many.zip");
  await writeFile(
    archive,
    zipBytes(
      Array.from({ length: 10_000 }, (_, index) => ({
        name: `${index}.txt`,
        data: Buffer.from("payload"),
      })),
    ),
  );
  const manifest = await inspectZip(archive);
  expect(manifest.entries).toHaveLength(10_000);
  expect(new Set(manifest.entries.map((entry) => entry.id)).size).toBe(10_000);
  expect(manifest.expandedBytes).toBe(70_000);
  expect(await readdir(output)).toEqual([]);
}, 30_000);

it.each(["same.txt", "SAME.TXT", "same.txt/child.txt"])(
  "rejects duplicate and conflicting ZIP paths before writing (%s)",
  async (second) => {
    const { root, source, output, job, deps } = await fixture();
    await writeFile(path.join(source, "same.txt"), "one");
    await writeFile(path.join(source, "other.txt"), "two");
    const archive = path.join(root, "duplicates.zip");
    await runCommand(path7za, ["a", "-tzip", archive, "same.txt", "other.txt"], { cwd: source });
    // Replace equal-length central/local names for cases the host filesystem cannot create.
    const bytes = await readFile(archive);
    if (second.length !== "other.txt".length) {
      await runCommand(path7za, ["rn", archive, "other.txt", second], {});
    } else {
      await writeFile(
        archive,
        Buffer.from(bytes.toString("latin1").replaceAll("other.txt", second), "latin1"),
      );
    }
    await expect(extractSessionSource(job, archive, output, deps)).rejects.toThrow(
      /duplicate|conflicting/i,
    );
    expect(await readdir(output)).toEqual([]);
  },
);
