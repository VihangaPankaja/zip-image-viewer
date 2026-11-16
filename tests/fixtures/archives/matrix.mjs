import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";

// Small genuine ZIP64: all sizes and offsets use the 64-bit directory extension.
function zipFixture(names, zip64 = false, method = 0) {
  const locals = [],
    headers = [];
  let offset = 0;
  for (const name of names) {
    const filename = Buffer.from(name),
      data = Buffer.from(name);
    const local = Buffer.alloc(30),
      header = Buffer.alloc(46),
      extra = Buffer.alloc(zip64 ? 28 : 0);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(zip64 ? 45 : 20, 6);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(zip64 ? 0xffffffff : data.length, 20);
    header.writeUInt32LE(zip64 ? 0xffffffff : data.length, 24);
    header.writeUInt16LE(filename.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    if (zip64) {
      extra.writeUInt16LE(1);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(data.length), 4);
      extra.writeBigUInt64LE(BigInt(data.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    locals.push(local, filename, data);
    headers.push(header, filename, extra);
    offset += local.length + filename.length + data.length;
  }
  const central = Buffer.concat(headers),
    end = Buffer.alloc(22),
    extensions = [];
  if (zip64) {
    const record = Buffer.alloc(56),
      locator = Buffer.alloc(20);
    record.writeUInt32LE(0x06064b50);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(names.length), 24);
    record.writeBigUInt64LE(BigInt(names.length), 32);
    record.writeBigUInt64LE(BigInt(central.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50);
    locator.writeBigUInt64LE(BigInt(offset + central.length), 8);
    locator.writeUInt32LE(1, 16);
    extensions.push(record, locator);
  }
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(zip64 ? 0xffff : names.length, 8);
  end.writeUInt16LE(zip64 ? 0xffff : names.length, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : central.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...locals, central, ...extensions, end]);
}

export async function verifyArchiveMatrix(
  root,
  { executable, extractWith7zip, inspect7zip, extractZip, extractSessionSource },
) {
  await mkdir(root, { recursive: true });
  const input = path.join(root, "input");
  await mkdir(input);
  const members = ["日本語.txt", "Folder/note.txt"];
  const stamp = new Date("2020-01-02T03:04:06Z");
  await mkdir(path.join(input, "Folder"));
  for (const name of members) {
    await writeFile(path.join(input, name), name);
    await utimes(path.join(input, name), stamp, stamp);
  }
  const create = (filename, switches) =>
    execFileSync(executable, ["a", ...switches, filename, "."], { cwd: input });
  const verify = async (filename, label, zip = false, timestamps = true) => {
    const output = path.join(root, label);
    await mkdir(output);
    assert.deepEqual(
      (await inspect7zip(executable, filename)).entries
        .filter((entry) => !entry.directory)
        .map((entry) => entry.path.replaceAll("\\", "/"))
        .sort(),
      [...members].sort(),
    );
    if (zip) await extractZip(filename, output, undefined, () => {});
    else await extractWith7zip(executable, filename, output);
    for (const name of members) {
      assert.equal(await readFile(path.join(output, name), "utf8"), name);
      if (timestamps) assert.equal((await stat(path.join(output, name))).mtimeMs, stamp.getTime());
    }
  };
  for (const method of ["Copy", "Deflate"]) {
    const filename = path.join(root, `zip-${method}.zip`);
    create(filename, ["-tzip", `-mm=${method}`]);
    await verify(filename, `zip-${method}`, true);
  }
  for (const method of ["LZMA", "LZMA2"]) {
    const filename = path.join(root, `${method}.7z`);
    create(filename, ["-t7z", `-m0=${method}`]);
    await verify(filename, method);
  }
  const tar = path.join(root, "members.tar");
  create(tar, ["-ttar"]);
  await verify(tar, "tar");
  const zip64 = path.join(root, "zip64.zip");
  await writeFile(zip64, zipFixture(members, true));
  await verify(zip64, "zip64", true, false);
  const extensionless = path.join(root, "source.bin");
  await writeFile(extensionless, await readFile(tar));
  const detected = path.join(root, "detected");
  await mkdir(detected);
  await extractSessionSource(
    {
      url: "https://example.com/source.bin",
      sourceKind: "http",
      abortController: new AbortController(),
    },
    extensionless,
    detected,
    {
      emitJob: (job, patch) => Object.assign(job, patch),
      detectEncryption: async () => false,
      extractWith7zip: (source, output) => extractWith7zip(executable, source, output),
      listExtractedEntries: async () => [],
    },
  );
  assert.equal(await readFile(path.join(detected, members[0]), "utf8"), members[0]);
  const split = path.join(root, "split.7z");
  await writeFile(path.join(input, "日本語.txt"), Buffer.alloc(1024 * 1000, 65));
  create(split, ["-t7z", "-mx=0", "-v1k"]);
  const splitParts = (await readdir(root))
    .filter((name) => /^split\.7z\.\d+$/.test(name))
    .sort((a, b) => Number(path.extname(a).slice(1)) - Number(path.extname(b).slice(1)));
  assert.ok(splitParts.length > 1000, "Exercise numbering beyond .999");
  const splitOut = path.join(root, "split-output");
  await mkdir(splitOut);
  const last = path.join(root, splitParts.at(-1));
  await rename(last, `${last}.held`);
  await assert.rejects(extractWith7zip(executable, `${split}.001`, splitOut), {
    name: "ArchiveVolumesRequired",
  });
  assert.deepEqual(await readdir(splitOut), []);
  await rename(`${last}.held`, last);
  await extractWith7zip(executable, `${split}.1000`, splitOut);
  assert.equal((await readFile(path.join(splitOut, "日本語.txt"))).length, 1024 * 1000);
  for (const [label, names, method, pattern] of [
    ["collision", ["Folder/one.txt", "folder/two.txt"], 0, /case.*collision/i],
    ["unsupported", ["note.txt"], 0xffff, /Unsupported.*Repack/],
  ]) {
    const filename = path.join(root, `${label}.zip`);
    await writeFile(filename, zipFixture(names, false, method));
    const output = path.join(root, label);
    await mkdir(output);
    await assert.rejects(
      extractZip(filename, output, undefined, () => {}),
      pattern,
    );
    assert.deepEqual(await readdir(output), []);
    if (label === "collision")
      await assert.rejects(extractWith7zip(executable, filename, output), pattern);
  }
  const unicodeNames = Array.from(
    { length: 1000 },
    (_, index) => `${index}-${"日本語".repeat(10)}.txt`,
  );
  const unicode = path.join(root, "unicode-chunks.zip");
  await writeFile(unicode, zipFixture(unicodeNames));
  assert.deepEqual(
    (await inspect7zip(executable, unicode)).entries.map((entry) => entry.path),
    unicodeNames,
  );
  const samples = JSON.parse(await readFile(new URL("./rar.json", import.meta.url), "utf8"));
  for (const sample of samples) {
    const bytes = Buffer.from(sample.base64, "base64");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sample.sha256);
    await writeFile(
      path.join(root, sample.name.replace(/\.part(\d)\.rar$/, ".part0$1.rar")),
      bytes,
    );
  }
  for (const [name, member, size, checksum] of [
    [samples[0].name, "test.bin", 1200, 0x7cca70cd],
    [
      samples[1].name.replace(".part1.rar", ".part01.rar"),
      "LibarchiveAddingTest.html",
      20111,
      0x5e05a663,
    ],
  ]) {
    const filename = path.join(root, name),
      output = path.join(root, `${name}-output`);
    await mkdir(output);
    assert.equal((await inspect7zip(executable, filename)).entries[0].size, size);
    await extractWith7zip(executable, filename, output);
    const bytes = await readFile(path.join(output, member));
    assert.equal(bytes.length, size);
    assert.equal(crc32(bytes), checksum);
  }
  const rarLast = path.join(root, samples.at(-1).name.replace(".part3.rar", ".part03.rar"));
  await rm(rarLast);
  const rarMissing = path.join(root, "rar-missing");
  await mkdir(rarMissing);
  await assert.rejects(
    extractWith7zip(
      executable,
      path.join(root, samples[1].name.replace(".part1.rar", ".part01.rar")),
      rarMissing,
    ),
    {
      name: "ArchiveVolumesRequired",
    },
  );
  assert.deepEqual(await readdir(rarMissing), []);
}
