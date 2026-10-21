import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeGalleryManifests, type GalleryManifest } from "./galleryManifest";

export default async function galleryTeardown() {
  const directory = path.resolve("test-results/pr-screenshots");
  const files = (await readdir(directory)).filter((file) =>
    /^manifest-worker-.*\.json$/.test(file),
  );
  const fragments = await Promise.all(
    files.map(
      async (file) =>
        JSON.parse(await readFile(path.join(directory, file), "utf8")) as GalleryManifest,
    ),
  );
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(mergeGalleryManifests(fragments), null, 2),
  );
}
