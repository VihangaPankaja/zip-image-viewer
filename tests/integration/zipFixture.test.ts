import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import unzipper from "unzipper";
import { describe, expect, it } from "vitest";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";

function createZip(
  archivePath: string,
  sourceDirectory: string,
): Promise<void> {
  return runCommand(path7za, ["a", "-tzip", archivePath, "."], {
    cwd: sourceDirectory,
  });
}

describe("real ZIP fixture", () => {
  it("creates and reads nested archive entries without path escape", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "ziv-zip-"));
    const sourceDirectory = path.join(workspace, "source");
    const nestedDirectory = path.join(sourceDirectory, "album");
    const archivePath = path.join(workspace, "fixture.zip");
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(path.join(nestedDirectory, "caption.txt"), "hello media");

    try {
      await createZip(archivePath, sourceDirectory);
      const archive = await unzipper.Open.file(archivePath);
      const paths = archive.files.map((entry) =>
        entry.path.replace(/\\/g, "/"),
      );

      expect(paths).toContain("album/caption.txt");
      expect(paths.every((entry) => !entry.split("/").includes(".."))).toBe(
        true,
      );
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
