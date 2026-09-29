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
const fixtures = [
  {
    name: "long-gop.mp4",
    args: [
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
      "-c:a",
      "aac",
      "-shortest",
    ],
  },
  {
    name: "vfr-silent.mp4",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=30:duration=6",
      "-vf",
      "select=not(mod(n\\,3))",
      "-fps_mode",
      "vfr",
      "-c:v",
      "libx264",
    ],
  },
  {
    name: "unsupported-mpeg4.mp4",
    args: [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=24:duration=6",
      "-c:v",
      "mpeg4",
      "-q:v",
      "4",
    ],
  },
];
for (const { name, args } of fixtures) {
  execFileSync(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    ...args,
    "-pix_fmt",
    "yuv420p",
    path.join(extractDir, "direct", name),
  ]);
}

const { buildTree } = await import(builtModule("domain/explorerTree.js"));
const { sessionStore } = await import(
  builtModule("repositories/memoryStores.js")
);
const { tree, firstFilePath, stats } = buildTree(
  fixtures.map(({ name }) => ({
    relativePath: `direct/${name}`,
    type: "file",
    size: statSync(path.join(extractDir, "direct", name)).size,
    modifiedAt: Date.now(),
  })),
  "long-gop.mp4",
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
