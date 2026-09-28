import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ffmpegPath from "ffmpeg-static";

const builtModule = (name) =>
  pathToFileURL(path.join(process.cwd(), "build/server", name)).href;

const directory = mkdtempSync(path.join(tmpdir(), "ziv-browser-hls-"));
const extractDir = path.join(directory, "extracted");
mkdirSync(path.join(extractDir, "direct"), { recursive: true });
const source = path.join(extractDir, "direct", "source.mp4");
execFileSync(ffmpegPath, [
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=24:duration=14",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=14",
  "-c:v",
  "libx264",
  "-g",
  "240",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  source,
]);

const { buildTree } = await import(builtModule("domain/explorerTree.js"));
const { sessionStore } = await import(
  builtModule("repositories/memoryStores.js")
);
const { tree, firstFilePath, stats } = buildTree(
  [
    {
      relativePath: "direct/source.mp4",
      type: "file",
      size: statSync(source).size,
      modifiedAt: Date.now(),
    },
  ],
  "source.mp4",
);
sessionStore.set("00000000-0000-4000-8000-000000000009", {
  id: "00000000-0000-4000-8000-000000000009",
  workspaceDir: directory,
  extractDir,
  tree,
  firstFilePath,
  stats,
  selectedVideoQuality: "360p",
  transcodeStatus: { quality: "360p", done: true, completed: 0, total: 1 },
  lastAccessedAt: Date.now(),
});

await import(builtModule("runtimeComposition.js"));
