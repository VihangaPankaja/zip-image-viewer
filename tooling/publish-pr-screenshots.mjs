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
if (
  manifest.captures.length !== 104 ||
  new Set(manifest.captures.map((capture) => capture.file)).size !== 104
)
  throw new Error(
    "Expected all 13 screens in both themes on four devices. Run screenshots:pr again.",
  );
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
    for (const capture of entries.filter((entry) => entry.theme === theme)) {
      const label = capture.screen.replaceAll("-", " ");
      lines.push(
        `**${label}**`,
        "",
        `![${device} ${theme}: ${label}](https://raw.githubusercontent.com/${repository}/${assetCommit}/${capture.file})`,
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
