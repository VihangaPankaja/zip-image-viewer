import { execFileSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { path7za } from "7zip-bin";
import { publishScreenshotRelease } from "./pr-screenshot-release.mjs";
import {
  groupScreenshotGalleries,
  prepareScreenshotGalleries,
  renderScreenshotSection,
} from "./pr-screenshot-gallery.mjs";

const run = (command, args, cwd = process.cwd()) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const directory = path.resolve("test-results/pr-screenshots");
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
const head = run("git", ["rev-parse", "HEAD"]);
if (head !== manifest.sourceCommit)
  throw new Error("Screenshots are stale. Capture again at the current commit.");
if (run("git", ["status", "--porcelain", "--untracked-files=normal"]))
  throw new Error("Commit implementation changes before publishing screenshots.");
const requiredScreens = [
  "video-opt-in-encoding-playback",
  "video-opt-in-encoding-seek",
  "torrent-early-playback",
  "torrent-early-seek-committed",
  "torrent-download-first",
  "torrent-playback-retry",
  "video-warm-high-playback",
  "video-warm-quality-choice",
  "video-warm-fallback-playback",
  "video-full-seek-timeline",
  "video-long-seek-preview",
  "video-priority-seek-committed",
  "video-audio-language-choice",
  "video-audio-spanish-captions",
  "video-embedded-subtitles-error",
  "video-embedded-subtitles-recovered",
  "session-storage-totals",
  "session-storage-pinned",
  "session-storage-cache-cleared",
  "session-storage-delete-warning",
  "session-storage-delete-blocked",
  "session-storage-deleted",
  "downloads-empty",
  "http-and-torrent-downloads",
  "settings",
  "settings-more",
  "add-downloads",
  "download-keyboard-announcement",
  "download-focus-returned",
  "download-storage-rejected",
  "explorer",
  "preview-png",
  "preview-txt",
  "preview-mp4",
  "video-remux-playback",
  "video-transcode-fallback",
  "video-qualities-pending",
  "video-probe-fallback",
  "preview-wav",
  "preview-zip",
  "slideshow",
  "explorer-dialog",
  "video-seek-preview",
  "video-seek-committed",
  "torrent-file-selection",
  "torrent-selection-started",
  "explorer-text-filter",
  "explorer-filter-opened",
  "torrent-video-filter",
  "torrent-filter-selection",
  "torrent-file-states",
  "torrent-priority-changed",
  "torrent-transfer-limits",
  "torrent-state-filter",
  "torrent-skipped-files",
  "torrent-available-files",
  "torrent-download-skipped-selection",
  "torrent-download-skipped-started",
  "torrent-retained-files-ready",
  "video-subtitles-loaded",
  "video-subtitles-adjusted",
  "video-subtitles-error",
  "video-subtitles-recovered",
  "explorer-path-search",
  "explorer-search-keyboard-focused",
  "explorer-search-keyboard-opened",
  "torrent-keyboard-selection",
  "loaded-video-downloads-visit",
  "video-return-paused-position",
  "torrent-large-folder-page",
  "torrent-large-folder-selection",
  "explorer-large-collection",
];
const featuredScreens = (process.env.PR_SCREENSHOT_FEATURED ?? "")
  .split(",")
  .map((screen) => screen.trim())
  .filter(Boolean);
if (
  new Set(featuredScreens).size !== featuredScreens.length ||
  featuredScreens.some((screen) => !requiredScreens.includes(screen))
)
  throw new Error("PR_SCREENSHOT_FEATURED must list unique gallery screen names.");
for (const device of ["Mobile", "Tablet", "Desktop", "Ultrawide"]) {
  for (const theme of ["light", "dark"]) {
    for (const screen of requiredScreens) {
      if (
        manifest.captures.filter(
          (capture) =>
            capture.device === device && capture.theme === theme && capture.screen === screen,
        ).length !== 1
      )
        throw new Error(
          `Missing or duplicate ${device} ${theme} ${screen}. Run screenshots:pr again.`,
        );
    }
  }
}
if (new Set(manifest.captures.map((capture) => capture.file)).size !== manifest.captures.length)
  throw new Error("Screenshot filenames must be unique.");
const repository = run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid GitHub repository name.");
const hash = createHash("sha256");
for (const capture of manifest.captures) {
  if (!/^[a-z0-9-]+\.png$/.test(capture.file)) throw new Error("Invalid screenshot filename.");
}
const groups = groupScreenshotGalleries(manifest.captures, featuredScreens);
const generatedAssets = await prepareScreenshotGalleries(directory, groups);
const assetFiles = [
  "manifest.json",
  ...manifest.captures.map((capture) => capture.file),
  ...generatedAssets,
];
for (const file of assetFiles) {
  hash.update(file);
  hash.update(await readFile(path.join(directory, file)));
}
const assetPrefix = `${head.slice(0, 12)}-${hash.digest("hex").slice(0, 12)}-`;
const releaseTag = process.env.PR_SCREENSHOT_RELEASE ?? "pr-review-assets";
const assetBaseUrl = `https://github.com/${repository}/releases/download/${releaseTag}`;
const archiveName = `${assetPrefix}originals.zip`;
const section = renderScreenshotSection({
  groups,
  assetBaseUrl,
  assetPrefix,
  originalArchiveUrl: `${assetBaseUrl}/${archiveName}`,
  sourceCommit: head,
  fixtures: manifest.fixtures,
});
const temporary = await mkdtemp(path.join(os.tmpdir(), "zip-viewer-review-"));
try {
  const listPath = path.join(temporary, "originals.txt");
  await writeFile(listPath, assetFiles.join("\n"));
  if (process.platform !== "win32") await chmod(path7za, 0o755);
  run(
    path7za,
    ["a", "-tzip", "-mx=0", path.join(temporary, archiveName), `@${listPath}`],
    directory,
  );
  const publishedFiles = groups.flatMap((group) => [
    ...group.featured.map((entry) => entry.file),
    ...group.sheets.map((sheet) => sheet.file),
  ]);
  for (const file of publishedFiles)
    await cp(path.join(directory, file), path.join(temporary, `${assetPrefix}${file}`));
  const names = [archiveName, ...publishedFiles.map((file) => `${assetPrefix}${file}`)];
  await publishScreenshotRelease({
    run: (args) => run("gh", args),
    repository,
    sourceCommit: head,
    tag: releaseTag,
    files: names.map((name) => ({ name, path: path.join(temporary, name) })),
  });
  await writeFile(path.join(directory, "pr-section.md"), section);
  console.log(
    `Published ${manifest.captures.length} screenshots as release assets. Append ${path.join(directory, "pr-section.md")} to the PR description. No asset branch was created.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
