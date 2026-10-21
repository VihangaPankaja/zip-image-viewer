import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

export default async function gallerySetup() {
  const directory = path.resolve("test-results/pr-screenshots");
  await mkdir(directory, { recursive: true });
  // Keep image evidence, but never merge fragments left by an earlier run.
  for (const file of await readdir(directory)) {
    if (file === "manifest.json" || /^manifest-worker-.*\.json$/.test(file))
      await unlink(path.join(directory, file));
  }
}
