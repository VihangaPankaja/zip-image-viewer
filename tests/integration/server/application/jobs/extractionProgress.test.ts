import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { path7za } from "7zip-bin";
import { jobSchema } from "../../../../../shared/contracts.js";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { extractSessionSource } from "../../../../../server/application/jobs/extractSessionSource.js";
import { stageExtraction } from "../../../../../server/infrastructure/archive/stagedExtraction.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";
import { inspectZip } from "../../../../../server/infrastructure/archive/zipManifest.js";
import { extractRuntimeArchive } from "../../../../../server/runtimeAdapters.js";
import { runCommand } from "../../../../../server/infrastructure/process/commandRunner.js";
import { zipBytes } from "../../../../fixtures/zipBytes.js";

const directories: string[] = [];
const disk = vi.hoisted(() => ({ full: false }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
      const stream = actual.createWriteStream(...args);
      if (disk.full) {
        disk.full = false;
        stream._write = (_chunk, _encoding, callback) =>
          callback(Object.assign(new Error("Disk is full"), { code: "ENOSPC" }));
      }
      return stream;
    },
  };
});
afterEach(async () => {
  disk.full = false;
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "extraction-progress-"));
  directories.push(root);
  const output = path.join(root, "extracted");
  await mkdir(output);
  const archive = path.join(root, "fixture.zip");
  await writeFile(
    archive,
    zipBytes([
      { name: "album/first.txt", data: Buffer.alloc(512 * 1024, 65) },
      { name: "album/second.txt", data: Buffer.from("second") },
      { name: "empty.txt", data: Buffer.alloc(0) },
    ]),
  );
  const manager = createJobManager(new Map(), vi.fn());
  const job = manager.createJob("https://example.com/fixture.zip");
  job.abortController = new AbortController();
  const updates: ReturnType<typeof manager.sanitizeJob>[] = [];
  const deps: Parameters<typeof extractSessionSource>[3] = {
    emitJob: (active, patch) => {
      manager.emitJob(active, patch);
      updates.push(manager.sanitizeJob(active));
    },
    detectEncryption: () => Promise.resolve(false),
    extractWith7zip: (source, destination, signal, progress) =>
      extractRuntimeArchive(path7za, source, destination, signal, progress),
    listExtractedEntries,
  };
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 2_000));
  return { root, output, archive, manager, job, updates, deps };
}

it("reports fixed selected totals, streamed bytes and verified entry counts through the API", async () => {
  const { output, archive, job, updates, deps } = await fixture();
  const manifest = await inspectZip(archive);
  job.zipSelection = {
    fingerprint: manifest.fingerprint,
    selectedIds: manifest.entries
      .filter((entry) => entry.path !== "empty.txt")
      .map((entry) => entry.id),
    extractedIds: [],
  };
  await stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps));
  const progress = updates
    .map((update) => jobSchema.parse(update))
    .filter((update) => update.extraction?.stage === "extracting");
  expect(progress.length).toBeGreaterThan(2);
  expect(progress.every((update) => update.extraction?.totalEntries === 2)).toBe(true);
  expect(progress.every((update) => update.extraction?.totalExpandedBytes === 512 * 1024 + 6)).toBe(
    true,
  );
  expect(
    progress.some(
      (update) =>
        update.extraction?.currentEntry === "album/first.txt" &&
        update.extraction.expandedBytes > 0 &&
        update.extraction.completedEntries === 0,
    ),
  ).toBe(true);
  const bytes = progress.map((update) => update.extraction?.expandedBytes ?? 0);
  expect(bytes).toEqual([...bytes].sort((a, b) => a - b));
  expect(
    updates
      .filter((update) => update.status === "extracting")
      .every((update) => update.percent === null || update.percent < 100),
  ).toBe(true);
  expect(updates.at(-1)?.extraction).toMatchObject({
    stage: "publishing",
    completedEntries: 2,
    expandedBytes: 512 * 1024 + 6,
  });
  expect(await readdir(output)).toEqual(["album"]);
});

it("keeps zero-byte files below completion until their entries have been checked", async () => {
  const { output, archive, job, updates, deps } = await fixture();
  await writeFile(archive, zipBytes([{ name: "a.txt" }, { name: "b.txt" }]));
  await extractSessionSource(job, archive, output, deps);
  expect(
    updates.some((update) => update.extraction?.completedEntries === 1 && update.percent === 50),
  ).toBe(true);
  expect(updates.at(-1)?.extraction).toMatchObject({
    completedEntries: 2,
    totalEntries: 2,
    expandedBytes: 0,
    totalExpandedBytes: 0,
  });
  expect(updates.every((update) => update.percent !== 100)).toBe(true);
});

it("does not count or publish an entry whose bytes fail their CRC", async () => {
  const { root, output, archive, job, updates, deps } = await fixture();
  const original = await readFile(archive);
  const damaged = Buffer.from(original);
  damaged[30 + Buffer.byteLength("album/first.txt")] ^= 1;
  await writeFile(archive, damaged);
  await writeFile(path.join(output, "previous.txt"), "published");
  await expect(
    stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps)),
  ).rejects.toThrow(/integrity/);
  expect(updates.every((update) => !update.extraction?.completedEntries)).toBe(true);
  expect(await readdir(output)).toEqual(["previous.txt"]);
  expect(await readdir(root)).not.toContain("extracted.staging");
  expect(await readFile(archive)).toEqual(damaged);
});

it("does not publish output when cancellation arrives after extraction finishes", async () => {
  const { output, archive, job, deps } = await fixture();
  await writeFile(path.join(output, "previous.txt"), "published");
  await expect(
    stageExtraction(
      output,
      async (staging) => {
        const entries = await extractSessionSource(job, archive, staging, deps);
        job.abortController?.abort();
        return entries;
      },
      job.abortController?.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(await readdir(output)).toEqual(["previous.txt"]);
});

it("keeps published files and the source after an ENOSPC write failure, then retries cleanly", async () => {
  const { root, output, archive, job, deps } = await fixture();
  const source = await readFile(archive);
  await writeFile(path.join(output, "previous.txt"), "published");
  disk.full = true;
  await expect(
    stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps)),
  ).rejects.toMatchObject({ code: "ENOSPC" });
  expect(await readdir(output)).toEqual(["previous.txt"]);
  expect(await readdir(root)).not.toContain("extracted.staging");
  expect(await readFile(archive)).toEqual(source);
  await stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps));
  expect(await readFile(path.join(output, "album", "first.txt"))).toEqual(
    Buffer.alloc(512 * 1024, 65),
  );
});

it("cancels during a large entry, removes staging and retries from the intact source", async () => {
  const { root, output, archive, job, deps } = await fixture();
  const original = await readFile(archive);
  await writeFile(path.join(output, "previous.txt"), "published");
  const emit = deps.emitJob;
  deps.emitJob = (active, patch) => {
    emit(active, patch);
    if ((patch.extraction?.expandedBytes ?? 0) > 0) active.abortController?.abort();
  };
  await expect(
    stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps)),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(await readdir(output)).toEqual(["previous.txt"]);
  expect(await readdir(root)).not.toContain("extracted.staging");
  expect(await readFile(archive)).toEqual(original);
  job.abortController = new AbortController();
  deps.emitJob = emit;
  await stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps));
  expect(await readFile(path.join(output, "album", "first.txt"))).toEqual(
    Buffer.alloc(512 * 1024, 65),
  );
});

it.each(["7z", "tar", "gzip"])(
  "reports real %s extraction without inventing gzip totals",
  async (format) => {
    const { root, output, job, updates, deps } = await fixture();
    const source = path.join(root, "source.txt");
    await writeFile(source, "real archive bytes");
    const archive = path.join(root, format === "gzip" ? "fixture.gz" : `fixture.${format}`);
    await runCommand(path7za, ["a", `-t${format}`, archive, source]);
    await stageExtraction(output, (staging) => extractSessionSource(job, archive, staging, deps));
    expect(updates.some((update) => update.extraction?.currentEntry === "source.txt")).toBe(true);
    expect(updates.at(-1)?.extraction).toMatchObject({
      stage: "publishing",
      completedEntries: 1,
      totalEntries: 1,
      expandedBytes: 18,
      totalExpandedBytes: format === "gzip" ? null : 18,
    });
    expect(await readFile(path.join(output, "source.txt"), "utf8")).toBe("real archive bytes");
  },
);
