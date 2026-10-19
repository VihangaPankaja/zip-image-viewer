import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { prepareDownloadFiles } from "./downloadFiles.js";

it("unlinks owned junctions without following them and preserves unexpected directories", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "download-path-kind-"));
  const other = path.join(directory, "retained");
  const target = path.join(directory, "download.bin");
  try {
    await mkdir(other);
    await writeFile(path.join(other, "kept.txt"), "retained bytes");
    await symlink(other, target, "junction");
    await expect(prepareDownloadFiles(target, { size: 20, resume: true })).resolves.toBe(0);
    expect(await readFile(path.join(other, "kept.txt"), "utf8")).toBe("retained bytes");
    await mkdir(target);
    await writeFile(path.join(target, "kept.txt"), "unexpected directory bytes");
    await expect(prepareDownloadFiles(target, { size: 20, resume: false })).rejects.toMatchObject({
      code: "DOWNLOAD_FATAL",
    });
    expect(await readFile(path.join(target, "kept.txt"), "utf8")).toBe(
      "unexpected directory bytes",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
