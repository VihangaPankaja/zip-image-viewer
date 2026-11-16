import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { path7za } from "7zip-bin";
import { verifyArchiveMatrix } from "../fixtures/archives/matrix.mjs";

const builtModule = pathToFileURL(
  path.join(process.cwd(), "build/server/infrastructure/process/commandRunner.js"),
).href;
const { detectArchiveEncryption, extractWith7zip, inspect7zip, runCommandCapture } = await import(
  builtModule
);
const { extractZip } = await import(
  pathToFileURL(path.resolve("build/server/infrastructure/archive/extractZip.js")).href
);
const { extractSessionSource } = await import(
  pathToFileURL(path.resolve("build/server/application/jobs/extractSessionSource.js")).href
);
const { planSelectionExport } = await import(
  pathToFileURL(path.resolve("build/server/application/sessions/selectionExport.js")).href
);
const { streamSelectionZip } = await import(
  pathToFileURL(path.resolve("build/server/infrastructure/archive/streamSelectionZip.js")).href
);
const { buildTree } = await import(
  pathToFileURL(path.resolve("build/server/domain/explorerTree.js")).href
);
assert.equal(path7za, "7za", "Production must use the maintained system extractor");
const info = execFileSync(path7za, ["i"], { encoding: "utf8" });
assert.match(info, /Rar5/, "The production extractor must retain RAR support");
const nativeInventory = JSON.parse(
  await readFile("/usr/local/share/doc/7zip/7zip.cdx.json", "utf8"),
);
const [nativeTool] = nativeInventory.components;
assert.equal(nativeTool.name, "7-Zip");
assert.equal(nativeTool.purl, `pkg:generic/7-zip@${nativeTool.version}`);
assert.equal(nativeTool.cpe, `cpe:2.3:a:7-zip:7-zip:${nativeTool.version}:*:*:*:*:*:*:*`);
assert.equal(
  info.match(/^7-Zip.*? (\d+\.\d+) /m)?.[1],
  nativeTool.version,
  "The declared 7-Zip version must match the installed executable",
);

const directory = await mkdtemp(path.join(tmpdir(), "ziv-container-archives-"));
const source = path.join(directory, "source");
const members = ["Folder/note[1].txt", "@list.txt", "-option.txt", "日本語.txt"];
const modifiedAt = new Date("2020-01-02T03:04:05Z");
try {
  await verifyArchiveMatrix(path.join(directory, "matrix"), {
    executable: path7za,
    extractZip,
    extractWith7zip,
    inspect7zip,
    extractSessionSource,
  });
  await mkdir(path.join(source, "Folder"), { recursive: true });
  await mkdir(path.join(source, "empty"));
  for (const member of members) {
    await writeFile(path.join(source, member), member);
    await utimes(path.join(source, member), modifiedAt, modifiedAt);
  }
  const exportFile = path.join(directory, "selection.zip");
  const exportSession = {
    extractDir: source,
    tree: buildTree(
      [
        ...members.map((relativePath) => ({
          relativePath,
          type: "file",
          size: Buffer.byteLength(relativePath),
          modifiedAt: modifiedAt.getTime(),
        })),
        { relativePath: "empty", type: "directory", size: 0, modifiedAt: modifiedAt.getTime() },
      ],
      "export",
    ).tree,
  };
  const exportSignal = new AbortController().signal;
  const exportPlan = await planSelectionExport(exportSession, ["."], exportSignal);
  await pipeline(
    Readable.from(streamSelectionZip(exportPlan.entries, exportPlan.root, exportSignal)),
    createWriteStream(exportFile),
  );
  const exported = path.join(directory, "exported");
  await mkdir(exported);
  execFileSync(path7za, ["x", "-y", `-o${exported}`, exportFile]);
  for (const member of members)
    assert.deepEqual(
      await readFile(path.join(exported, member)),
      await readFile(path.join(source, member)),
    );
  assert.deepEqual(await readdir(path.join(exported, "empty")), []);
  const reimported = path.join(directory, "reimported");
  await mkdir(reimported);
  await extractZip(exportFile, reimported, undefined, () => {});
  for (const member of members)
    assert.deepEqual(
      await readFile(path.join(reimported, member)),
      await readFile(path.join(source, member)),
    );
  for (const format of ["zip", "7z"]) {
    const archive = path.join(directory, `members.${format}`);
    const output = path.join(directory, format);
    await mkdir(output);
    execFileSync(path7za, ["a", `-t${format}`, archive, "."], { cwd: source });
    assert.equal(await detectArchiveEncryption(path7za, archive), false);
    await extractWith7zip(path7za, archive, output);
    for (const member of members) {
      assert.equal(await readFile(path.join(output, member), "utf8"), member);
      assert.equal((await stat(path.join(output, member))).mtimeMs, modifiedAt.getTime());
    }
    assert.deepEqual(await readdir(path.join(output, "empty")), []);
  }

  for (const format of ["zip", "7z"]) {
    const encrypted = path.join(directory, `encrypted.${format}`);
    await runCommandCapture(
      path7za,
      [
        "a",
        `-t${format}`,
        "-p",
        ...(format === "7z" ? ["-mhe=on"] : ["-mem=AES256"]),
        encrypted,
        ".",
      ],
      { cwd: source, stdin: "fixture-password\nfixture-password\n" },
    );
    assert.equal(await detectArchiveEncryption(path7za, encrypted), true);
    const output = path.join(directory, `decrypted-${format}`);
    await mkdir(output);
    await assert.rejects(extractWith7zip(path7za, encrypted, output, { password: "wrong" }), {
      code: "PASSWORD_REQUIRED",
    });
    await rm(output, { recursive: true });
    await mkdir(output);
    await extractWith7zip(path7za, encrypted, output, { password: "fixture-password" });
    for (const member of members)
      assert.equal(await readFile(path.join(output, member), "utf8"), member);
  }

  const rar = path.join(directory, "stored.rar");
  await writeFile(
    rar,
    Buffer.from(
      "UmFyIRoHAM+QcwAADQAAAAAAAAC0+nQAgCkACgAAAAoAAAADndKAsQAAAAAUMAkApIEAAGhlbGxvLnR4dGhlbGxvIHJhcgrEPXsAQAcA",
      "base64",
    ),
  );
  const rarOutput = path.join(directory, "rar");
  await mkdir(rarOutput);
  await extractWith7zip(path7za, rar, rarOutput);
  assert.equal(await readFile(path.join(rarOutput, "hello.txt"), "utf8"), "hello rar\n");

  const gzip = path.join(directory, "members.gz");
  await writeFile(
    gzip,
    Buffer.concat([gzipSync(Buffer.alloc(512, 65)), gzipSync(Buffer.from("B"))]),
  );
  const gzipOutput = path.join(directory, "gzip");
  await mkdir(gzipOutput);
  await extractWith7zip(path7za, gzip, gzipOutput);
  const [gzipMember] = await readdir(gzipOutput);
  assert.equal((await readFile(path.join(gzipOutput, gzipMember))).length, 513);

  await symlink("../outside.txt", path.join(source, "linked"));
  const linked = path.join(directory, "linked.tar");
  execFileSync(path7za, ["a", "-ttar", "-snl", linked, "linked"], { cwd: source });
  const linkedOutput = path.join(directory, "linked");
  await mkdir(linkedOutput);
  await assert.rejects(extractWith7zip(path7za, linked, linkedOutput), /links/);
  assert.deepEqual(await readdir(linkedOutput), []);
  process.stdout.write("Container archive smoke passed.\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}
