import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  rename,
  stat,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import { expect, test } from "vite-plus/test";
import {
  extractWith7zip,
  inspect7zip,
  runCommand,
} from "../../../../../server/infrastructure/process/commandRunner.js";
import { extractZip } from "../../../../../server/infrastructure/archive/extractZip.js";
import { zipBytes } from "../../../../fixtures/zipBytes.js";

test("preserves multibyte Unicode names across process output chunks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "archive-unicode-"));
  try {
    const names = Array.from({ length: 1000 }, (_, i) => `${i}-${"日本語".repeat(10)}.txt`);
    const archive = path.join(root, "unicode.zip");
    await writeFile(archive, zipBytes(names.map((name) => ({ name }))));
    const index = await inspect7zip(path7za, archive);
    expect(index.entries.map((entry) => entry.path)).toEqual(names);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsupported ZIP compression gives a repack action before any output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zip-method-"));
  try {
    const bytes = zipBytes([{ name: "note.txt", data: Buffer.from("contents") }]);
    bytes.writeUInt16LE(0xffff, 8);
    bytes.writeUInt16LE(0xffff, bytes.indexOf(Buffer.from("504b0102", "hex")) + 10);
    const archive = path.join(root, "book.zip");
    await writeFile(archive, bytes);
    const output = path.join(root, "output");
    await mkdir(output);
    await expect(extractZip(archive, output, undefined, () => undefined)).rejects.toThrow(
      /Unsupported ZIP compression.*Repack/,
    );
    expect(await readdir(output)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects Windows case collisions in implicit parent directories before writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zip-collision-"));
  try {
    const archive = path.join(root, "book.zip");
    await writeFile(archive, zipBytes([{ name: "Folder/one.txt" }, { name: "folder/two.txt" }]));
    const output = path.join(root, "output");
    await mkdir(output);
    await expect(extractZip(archive, output, undefined, () => undefined)).rejects.toThrow(
      /case.*collision/i,
    );
    expect(await readdir(output)).toEqual([]);
    await expect(inspect7zip(path7za, archive)).rejects.toThrow(/case.*collision/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("indexes split 7z contents, asks for a missing final volume before writing, and retries", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "archive-format-"));
  try {
    await writeFile(path.join(root, "日本語.txt"), Buffer.alloc(2048, 65));
    await runCommand(
      path7za,
      ["a", "-t7z", "-mx=0", "-v1k", path.join(root, "book.7z"), "日本語.txt"],
      { cwd: root },
    );
    const first = path.join(root, "book.7z.001");
    const index = await inspect7zip(path7za, first);
    expect(index.entries.map((e) => e.path)).toEqual(["日本語.txt"]);
    const parts = (await readdir(root)).filter((name) => name.startsWith("book.7z.")).sort();
    const last = path.join(root, parts[parts.length - 1]);
    await rename(last, `${last}.held`);
    const output = path.join(root, "output");
    await mkdir(output);
    await expect(extractWith7zip(path7za, first, output)).rejects.toMatchObject({
      name: "ArchiveVolumesRequired",
    });
    expect(await readdir(output)).toEqual([]);
    await rename(`${last}.held`, last);
    await extractWith7zip(path7za, first, output);
    expect((await readFile(path.join(output, "日本語.txt"))).length).toBe(2048);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ZIP writes preserve the recorded modification time on disk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zip-time-"));
  try {
    const stamp = new Date("2020-01-02T03:04:06Z");
    await writeFile(path.join(root, "note.txt"), "time fixture");
    await utimes(path.join(root, "note.txt"), stamp, stamp);
    const archive = path.join(root, "book.zip");
    await runCommand(path7za, ["a", "-tzip", archive, "note.txt"], { cwd: root });
    const output = path.join(root, "output");
    await mkdir(output);
    await extractZip(archive, output, undefined, () => undefined);
    expect((await stat(path.join(output, "note.txt"))).mtimeMs).toBe(stamp.getTime());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
