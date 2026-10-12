import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createJobManager } from "./jobManager.js";
import { extractSessionSource } from "./extractSessionSource.js";
import { listExtractedEntries } from "../../infrastructure/archive/listExtractedEntries.js";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function zip(entries: { name: string; size?: number; mode?: number }[]) {
  const locals: Buffer[] = [];
  const headers: Buffer[] = [];
  let offset = 0;
  for (const { name, size = 0, mode = 0 } of entries) {
    const filename = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(filename.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(3 << 8, 4);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(filename.length, 28);
    header.writeUInt32LE((mode << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    locals.push(local, filename);
    headers.push(header, filename);
    offset += local.length + filename.length;
  }
  const central = Buffer.concat(headers);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

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
    const job = createJobManager(new Map(), vi.fn()).createJob(
      "https://example.com/fixture.zip",
    );
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
