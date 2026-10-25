import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { extractSessionSource } from "../../../../../server/application/jobs/extractSessionSource.js";

const disk = vi.hoisted(() => ({ available: 64 * 1024 ** 2 + 127 }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  statfsSync: () => ({ bsize: 1, bavail: disk.available }),
}));

it("admits the retained direct-file copy before writing while preserving its verified source", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "direct-space-"));
  const source = path.join(directory, "source.txt");
  const output = path.join(directory, "extracted");
  const job = createJobManager(new Map(), vi.fn()).createJob("https://example.com/notes.txt");
  job.storageRoot = directory;
  const deps = {
    emitJob: vi.fn(),
    detectEncryption: vi.fn(),
    extractWith7zip: vi.fn(),
    listExtractedEntries: vi.fn(),
  };
  try {
    await mkdir(output);
    await writeFile(source, Buffer.alloc(128, 65));
    await expect(extractSessionSource(job, source, output, deps)).rejects.toThrow("storage");
    expect((await stat(source)).size).toBe(128);
    await expect(stat(path.join(output, "direct", "notes.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    disk.available += 1;
    await extractSessionSource(job, source, output, deps);
    expect(
      (await readFile(source)).equals(await readFile(path.join(output, "direct", "notes.txt"))),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
