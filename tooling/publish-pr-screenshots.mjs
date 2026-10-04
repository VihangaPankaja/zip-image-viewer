import { execFileSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = (command, args, cwd = process.cwd()) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const directory = path.resolve("test-results/pr-screenshots");
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8"),
);
const head = run("git", ["rev-parse", "HEAD"]);
if (head !== manifest.sourceCommit)
  throw new Error(
    "Screenshots are stale. Capture again at the current commit.",
  );
if (run("git", ["status", "--porcelain", "--untracked-files=normal"]))
  throw new Error(
    "Commit implementation changes before publishing screenshots.",
  );
const requiredScreens = [
  "downloads-empty",
  "http-and-torrent-downloads",
  "settings",
  "settings-more",
  "add-downloads",
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
  throw new Error(
    "PR_SCREENSHOT_FEATURED must list unique gallery screen names.",
  );
const featuredRank = new Map(
  featuredScreens.map((screen, index) => [screen, index]),
);
for (const device of ["Mobile", "Tablet", "Desktop", "Ultrawide"]) {
  for (const theme of ["light", "dark"]) {
    for (const screen of requiredScreens) {
      if (
        manifest.captures.filter(
          (capture) =>
            capture.device === device &&
            capture.theme === theme &&
            capture.screen === screen,
        ).length !== 1
      )
        throw new Error(
          `Missing or duplicate ${device} ${theme} ${screen}. Run screenshots:pr again.`,
        );
    }
  }
}
if (
  new Set(manifest.captures.map((capture) => capture.file)).size !==
  manifest.captures.length
)
  throw new Error("Screenshot filenames must be unique.");
const repository = run("gh", [
  "repo",
  "view",
  "--json",
  "nameWithOwner",
  "--jq",
  ".nameWithOwner",
]);
if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
  throw new Error("Invalid GitHub repository name.");
const hash = createHash("sha256");
for (const capture of manifest.captures) {
  if (!/^[a-z0-9-]+\.png$/.test(capture.file))
    throw new Error("Invalid screenshot filename.");
  hash.update(await readFile(path.join(directory, capture.file)));
}
const branch = `pr-assets/${head.slice(0, 12)}-${hash.digest("hex").slice(0, 12)}`;
const remote = run("git", ["remote", "get-url", "origin"]);
if (!run("git", ["ls-remote", "--heads", remote, `refs/heads/${branch}`])) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "zip-viewer-pr-assets-"),
  );
  for (const file of [
    "manifest.json",
    ...manifest.captures.map((capture) => capture.file),
  ]) {
    await cp(path.join(directory, file), path.join(temporary, file));
  }
  run("git", ["init", "--quiet"], temporary);
  run(
    "git",
    ["config", "user.name", run("git", ["config", "user.name"])],
    temporary,
  );
  run(
    "git",
    ["config", "user.email", run("git", ["config", "user.email"])],
    temporary,
  );
  run("git", ["add", "--", "."], temporary);
  run(
    "git",
    ["commit", "--quiet", "-m", `Review screenshots for ${head}`],
    temporary,
  );
  run("git", ["push", remote, `HEAD:refs/heads/${branch}`], temporary);
  console.log(`Asset checkout retained at ${temporary}`);
}
const assetCommit = run("git", [
  "ls-remote",
  "--heads",
  remote,
  `refs/heads/${branch}`,
]).split(/\s/)[0];
const lines = [
  "## Screenshots",
  "",
  `Captured from \`${head}\`. ${manifest.fixtures}`,
  "",
];
for (const device of ["Mobile", "Tablet", "Desktop", "Ultrawide"]) {
  const entries = manifest.captures.filter(
    (capture) => capture.device === device,
  );
  lines.push(`### ${device} · ${entries[0].width} × ${entries[0].height}`, "");
  for (const theme of ["light", "dark"]) {
    lines.push(
      `<details><summary>${theme === "light" ? "Light" : "Dark"} theme</summary>`,
      "",
    );
    const themeEntries = entries.filter((entry) => entry.theme === theme);
    themeEntries.sort(
      (a, b) =>
        (featuredRank.get(a.screen) ?? Infinity) -
        (featuredRank.get(b.screen) ?? Infinity),
    );
    for (const capture of themeEntries) {
      const label = capture.screen.replaceAll("-", " ");
      lines.push(
        `![${label}](https://raw.githubusercontent.com/${repository}/${assetCommit}/${capture.file})`,
        "",
      );
    }
    lines.push("</details>", "");
  }
}
await writeFile(path.join(directory, "pr-section.md"), lines.join("\n"));
console.log(
  `Published ${manifest.captures.length} screenshots. Append ${path.join(directory, "pr-section.md")} to the PR body.`,
);
