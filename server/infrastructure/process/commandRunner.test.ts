import { describe, expect, test } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import {
  extractWith7zip,
  runCommand,
  runCommandCapture,
} from "./commandRunner.js";

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
