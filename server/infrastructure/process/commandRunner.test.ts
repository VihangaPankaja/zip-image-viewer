import { describe, expect, test, vi } from "vitest";
import { type SpawnOptions } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import {
  extractWith7zip,
  runCommand,
  runCommandCapture,
} from "./commandRunner.js";

const disk = vi.hoisted(() => ({
  free: 64 * 1024 ** 2 + 512,
  size: 1,
  fail: true,
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
      if (command !== "storage-extractor")
        return actual.spawn(command, args, options);
      const script =
        args[0] === "l"
          ? `process.stdout.write('----------\\nPath = child.bin\\nSize = ${disk.size}\\n\\n')`
          : disk.fail
            ? "setInterval(() => {}, 1000)"
            : "";
      const child = actual.spawn(process.execPath, ["-e", script], options);
      if (args[0] === "x" && disk.fail)
        child.once("spawn", () => {
          disk.free = 0;
        });
      return child;
    },
  };
});

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
    await extractWith7zip("storage-extractor", "fixture.tar", directory);
  } finally {
    disk.free = 64 * 1024 ** 2 + 512;
    disk.size = 1;
    disk.fail = true;
    await rm(directory, { recursive: true, force: true });
  }
});

describe("commandRunner", () => {
  test("captures output and preserves command failure details", async () => {
    await expect(
      runCommandCapture(process.execPath, [
        "-e",
        "process.stdout.write('ready'); process.stderr.write('note')",
      ]),
    ).resolves.toEqual({ stdout: "ready", stderr: "note" });

    await expect(
      runCommand(process.execPath, [
        "-e",
        "process.stderr.write('failed'); process.exit(3)",
      ]),
    ).rejects.toThrow("failed");
  });
});

test.each([
  { name: "../outside.txt", link: false },
  { name: "linked", link: true },
  { name: "regular.txt", link: false },
])(
  "extracts regular TAR entries and rejects unsafe entries (%j)",
  async ({ name, link }) => {
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
  },
);
