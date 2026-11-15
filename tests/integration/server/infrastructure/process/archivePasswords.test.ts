import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import { expect, test, vi } from "vite-plus/test";
import type { SpawnOptions } from "node:child_process";
import {
  detectArchiveEncryption,
  extractWith7zip,
  inspect7zip,
  runCommandCapture,
} from "../../../../../server/infrastructure/process/commandRunner.js";
import { stageExtraction } from "../../../../../server/infrastructure/archive/stagedExtraction.js";

const launches = vi.hoisted(() => [] as { args: string[]; options: SpawnOptions }[]);
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: SpawnOptions) => {
      launches.push({ args, options });
      return actual.spawn(command, args, options);
    },
  };
});

test.each([
  { type: "zip", switches: [] },
  { type: "zip", switches: ["-mem=AES256"] },
  { type: "7z", switches: [] },
  { type: "7z", switches: ["-mhe=on"] },
])(
  "opens encrypted $type $switches using only stdin and permits a wrong-password retry",
  async ({ type, switches }) => {
    const root = await mkdtemp(path.join(tmpdir(), "archive-password-"));
    const password = `${type === "7z" ? "秘密 " : ""}$() ` + "` ' \" ; & test";
    try {
      launches.length = 0;
      await mkdir(path.join(root, "Folder"));
      await writeFile(path.join(root, "Folder", "note.txt"), "private fixture contents");
      const archive = path.join(root, `fixture.${type}`);
      await runCommandCapture(
        path7za,
        ["a", `-t${type}`, "-p", "-sccUTF-8", ...switches, archive, "Folder/note.txt"],
        {
          cwd: root,
          stdin: `${password}\n${password}\n`,
        },
      );
      expect(await detectArchiveEncryption(path7za, archive)).toBe(true);
      const output = path.join(root, "output");
      await mkdir(output);
      await expect(extractWith7zip(path7za, archive, output)).rejects.toMatchObject({
        code: "PASSWORD_REQUIRED",
      });
      expect(await readdir(output)).toEqual([]);
      await expect(
        extractWith7zip(path7za, archive, output, { password: "wrong" }),
      ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
      await rm(output, { recursive: true });
      await mkdir(output);
      await extractWith7zip(path7za, archive, output, { password, filePaths: ["Folder/note.txt"] });
      expect(await readFile(path.join(output, "Folder", "note.txt"), "utf8")).toBe(
        "private fixture contents",
      );
      for (const launch of launches) {
        expect(launch.args.some((argument) => argument.includes(password))).toBe(false);
        expect(
          Object.values(launch.options.env ?? {}).some((value) => value?.includes(password)),
        ).toBe(false);
        expect(launch.options.shell).toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("definite corruption stays distinct from a retryable password error", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "archive-corruption-"));
  try {
    const archive = path.join(root, "corrupt.7z");
    await writeFile(
      archive,
      Buffer.from("377abcaf271c0004ffff00000000000000000000000000000000000000000000", "hex"),
    );
    await expect(extractWith7zip(path7za, archive, root, { password: "private" })).rejects.toThrow(
      /corrupt|incomplete|unsupported/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("encryption words in ordinary filenames never become password requirements", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "archive-password-names-"));
  try {
    const name = "AES256 ZipCrypto 7zAES enter password.txt";
    await writeFile(path.join(root, name), "ordinary contents");
    const archive = path.join(root, "enter password.7z");
    await runCommandCapture(path7za, ["a", archive, name], { cwd: root });
    expect(await detectArchiveEncryption(path7za, archive)).toBe(false);
    expect((await inspect7zip(path7za, archive)).entries[0].path).toBe(name);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancel during encrypted extraction removes staged plaintext and preserves the source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "archive-password-cancel-"));
  try {
    const archive = path.join(root, "private.7z");
    await writeFile(path.join(root, "note.txt"), Buffer.alloc(1024 * 1024, 65));
    await runCommandCapture(path7za, ["a", "-t7z", "-p", archive, "note.txt"], {
      cwd: root,
      stdin: "private\nprivate\n",
    });
    const source = await readFile(archive);
    const controller = new AbortController();
    const output = path.join(root, "extracted");
    await expect(
      stageExtraction(
        output,
        async (staging) =>
          extractWith7zip(path7za, archive, staging, {
            password: "private",
            signal: controller.signal,
            onProgress: (progress) => {
              if (progress.expandedBytes > 0) controller.abort();
            },
          }),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await readdir(root)).not.toContain("extracted.staging");
    expect(await readdir(root)).not.toContain("extracted");
    expect(await readFile(archive)).toEqual(source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
