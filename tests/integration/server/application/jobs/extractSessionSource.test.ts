import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { extractSessionSource } from "../../../../../server/application/jobs/extractSessionSource.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";
import { zipBytes as zip } from "../../../../fixtures/zipBytes.js";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it.each([
  { entries: [{ name: "../outside.txt" }], error: "Unsafe" },
  { entries: [{ name: "/outside.txt" }], error: "Unsafe" },
  { entries: [{ name: "C:/outside.txt" }], error: "Unsafe" },
  { entries: [{ name: "link", mode: 0xa1ff }], error: "links" },
  {
    entries: Array.from({ length: 10_001 }, (_, index) => ({
      name: `${String(index)}.txt`,
    })),
    error: "10000",
  },
  {
    entries: [
      { name: "a", size: 4 * 1024 ** 3 - 2 },
      { name: "b", size: 4 * 1024 ** 3 - 2 },
      { name: "c", size: 4 * 1024 ** 3 - 2 },
    ],
    error: "10 GiB",
  },
])(
  "rejects invalid ZIP metadata before writing extraction files ($error)",
  async ({ entries, error }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "bounded-extract-"));
    workspaces.push(directory);
    const output = path.join(directory, "extracted");
    await mkdir(output);
    const archive = path.join(directory, "fixture.zip");
    await writeFile(archive, zip(entries));
    const job = createJobManager(new Map(), vi.fn()).createJob("https://example.com/fixture.zip");
    await expect(
      extractSessionSource(job, archive, output, {
        emitJob: vi.fn(),
        detectEncryption: () => Promise.resolve(false),
        extractWith7zip: vi.fn(),
        listExtractedEntries,
      }),
    ).rejects.toThrow(error);
    expect(await readdir(output)).toEqual([]);
  },
  30_000,
);
