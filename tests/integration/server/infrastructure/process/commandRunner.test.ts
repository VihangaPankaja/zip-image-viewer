import { describe, expect, test, vi } from "vite-plus/test";
import { type SpawnOptions } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import {
  extractWith7zip,
  runCommand,
  runCommandCapture,
} from "../../../../../server/infrastructure/process/commandRunner.js";

const disk = vi.hoisted(() => ({
  free: 64 * 1024 ** 2 + 512,
  size: 1,
  fail: true,
  outputBytes: 0,
  hold: false,
  aborted: false,
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  statfsSync: () => ({ bavail: disk.free, bsize: 1 }),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: SpawnOptions) => {
      if (command !== "storage-extractor") return actual.spawn(command, args, options);
      const script =
        args[0] === "l"
          ? `process.stdout.write('----------\\nPath = child.bin\\nSize = ${disk.size}\\n\\n')`
          : disk.fail
            ? "process.stdout.write('a'); setInterval(() => {}, 1000)"
            : `process.stdout.write(Buffer.alloc(${disk.outputBytes}));${disk.hold ? "setTimeout(() => process.exit(0), 300)" : ""}`;
      const child = actual.spawn(process.execPath, ["-e", script], options);
      child.once("error", (error) => {
        if (error.name === "AbortError") disk.aborted = true;
      });
      if (args[0] === "x" && disk.fail)
        child.once("spawn", () => {
          disk.free = 0;
        });
      return child;
    },
  };
});

test.each([false, true])(
  "rejects extraction beyond its reservation before admission of the output (held=%s)",
  async (hold) => {
    const directory = await mkdtemp(path.join(tmpdir(), "extraction-output-"));
    disk.fail = false;
    disk.outputBytes = 2;
    disk.hold = hold;
    try {
      await expect(
        extractWith7zip("storage-extractor", "fixture.gz", directory),
      ).rejects.toMatchObject({
        code: "DOWNLOAD_FATAL",
      });
      const files = await readdir(directory);
      for (const file of files) expect(await readFile(path.join(directory, file))).toHaveLength(0);
      if (hold) expect(disk.aborted).toBe(true);
    } finally {
      disk.fail = true;
      disk.outputBytes = 0;
      disk.hold = false;
      disk.aborted = false;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("reports extraction storage exhaustion instead of subprocess cancellation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "extraction-storage-"));
  try {
    await expect(
      extractWith7zip("storage-extractor", "fixture.tar", directory),
    ).rejects.toMatchObject({
      name: "Error",
      code: "DOWNLOAD_FATAL",
      message: "Insufficient storage for this download or extraction.",
    });
    disk.free = 64 * 1024 ** 2 + 512;
    disk.size = 512;
    disk.fail = false;
    disk.outputBytes = 512;
    const retry = path.join(directory, "retry");
    await mkdir(retry);
    await extractWith7zip("storage-extractor", "fixture.tar", retry);
  } finally {
    disk.free = 64 * 1024 ** 2 + 512;
    disk.size = 1;
    disk.fail = true;
    disk.outputBytes = 0;
    disk.aborted = false;
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects missing output for an ordinary declared archive entry", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "extraction-missing-"));
  disk.fail = false;
  try {
    await expect(extractWith7zip("storage-extractor", "fixture.7z", directory)).rejects.toThrow(
      "does not match its declared size",
    );
  } finally {
    disk.fail = true;
    await rm(directory, { recursive: true, force: true });
  }
});

test("streams literal 7-Zip members with their contents and timestamps intact", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "literal-archive-"));
  const source = path.join(directory, "source");
  const output = path.join(directory, "output");
  const archive = path.join(directory, "members.7z");
  const members = ["Folder/note[1].txt", "@list.txt", "-option.txt"];
  try {
    await mkdir(path.join(source, "Folder"), { recursive: true });
    await mkdir(path.join(source, "empty"));
    await mkdir(output);
    for (const [index, name] of members.entries()) {
      await writeFile(path.join(source, name), `member ${index}`);
      await utimes(
        path.join(source, name),
        new Date("2020-01-02T03:04:05Z"),
        new Date("2020-01-02T03:04:05Z"),
      );
    }
    await runCommand(path7za, ["a", "-t7z", archive, "."], { cwd: source });
    await extractWith7zip(path7za, archive, output);
    for (const [index, name] of members.entries()) {
      expect(await readFile(path.join(output, name), "utf8")).toBe(`member ${index}`);
      expect((await stat(path.join(output, name))).mtimeMs).toBe(
        Date.parse("2020-01-02T03:04:05Z"),
      );
    }
    expect(await readdir(path.join(output, "empty"))).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("commandRunner", () => {
  test("bounds captured archive metadata before accumulating oversized output", async () => {
    await expect(
      runCommandCapture(process.execPath, [
        "-e",
        "process.stdout.write(Buffer.alloc(11 * 1024 ** 2))",
      ]),
    ).rejects.toMatchObject({
      code: "DOWNLOAD_FATAL",
      message: "Command metadata exceeds the 10 MiB limit.",
    });
  });

  test("captures output and preserves command failure details", async () => {
    await expect(
      runCommandCapture(process.execPath, [
        "-e",
        "process.stdout.write('ready'); process.stderr.write('note')",
      ]),
    ).resolves.toEqual({ stdout: "ready", stderr: "note" });

    await expect(
      runCommand(process.execPath, ["-e", "process.stderr.write('failed'); process.exit(3)"]),
    ).rejects.toThrow("failed");
  });
});

test.each([512, 1024])(
  "enforces the actual size of concatenated gzip members within available capacity (%i)",
  async (capacity) => {
    const directory = await mkdtemp(path.join(tmpdir(), "gzip-capacity-"));
    const archive = path.join(directory, "members.gz");
    const output = path.join(directory, "output");
    disk.free = 64 * 1024 ** 2 + capacity;
    try {
      await mkdir(output);
      await writeFile(
        archive,
        Buffer.concat([gzipSync(Buffer.alloc(512, 65)), gzipSync(Buffer.from("B"))]),
      );
      if (capacity === 512) {
        await expect(extractWith7zip(path7za, archive, output)).rejects.toMatchObject({
          code: "DOWNLOAD_FATAL",
        });
        for (const file of await readdir(output))
          expect((await readFile(path.join(output, file))).length).toBeLessThanOrEqual(capacity);
      } else {
        await extractWith7zip(path7za, archive, output);
        const files = await readdir(output);
        expect(files).toHaveLength(1);
        expect(await readFile(path.join(output, files[0]))).toHaveLength(513);
      }
    } finally {
      disk.free = 64 * 1024 ** 2 + 512;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.each([
  { name: "../outside.txt", link: false },
  { name: "linked", link: true },
  { name: "regular.txt", link: false },
])("extracts regular TAR entries and rejects unsafe entries (%j)", async ({ name, link }) => {
  const directory = await mkdtemp(path.join(tmpdir(), "archive-preflight-"));
  const archive = path.join(directory, "fixture.tar");
  const output = path.join(directory, "output");
  const header = Buffer.alloc(512);
  header.write(name);
  header.write("0000777\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write("00000000000\0", 124);
  header.write("00000000000\0", 136);
  header.fill(32, 148, 156);
  header.write(link ? "2" : "0", 156);
  if (link) header.write("../other-session", 157);
  header.write("ustar\0", 257);
  header.write("00", 263);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  try {
    await mkdir(output);
    await writeFile(archive, Buffer.concat([header, Buffer.alloc(1024)]));
    if (name === "regular.txt") {
      await extractWith7zip(path7za, archive, output);
      expect(await readdir(output)).toEqual(["regular.txt"]);
    } else {
      await expect(extractWith7zip(path7za, archive, output)).rejects.toThrow(
        link ? "links" : "Unsafe",
      );
      expect(await readdir(output)).toEqual([]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
