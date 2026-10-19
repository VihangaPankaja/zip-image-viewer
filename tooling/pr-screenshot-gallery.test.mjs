import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vite-plus/test";
import sharp from "sharp";
import { publishScreenshotRelease } from "./pr-screenshot-release.mjs";
import {
  groupScreenshotGalleries,
  prepareScreenshotGalleries,
  renderScreenshotSection,
} from "./pr-screenshot-gallery.mjs";

const devices = ["Mobile", "Tablet", "Desktop", "Ultrawide"];
const featured = ["early-playback", "early-seek", "download-first", "retry"];
const captures = devices.flatMap((device) =>
  ["light", "dark"].flatMap((theme) =>
    Array.from({ length: 70 }, (_, index) => ({
      device,
      theme,
      width: device === "Mobile" ? 390 : 1440,
      height: 1000,
      screen: index < 4 ? featured[index] : `screen-${index}`,
      file: `${device.toLowerCase()}-${theme}-${index}.png`,
    })),
  ),
);

test("release publishing creates no branch, reuses assets and rejects inaccessible URLs", async () => {
  const calls = [];
  const requests = [];
  let exists = false;
  const run = (args) => {
    calls.push(args);
    if (args[0] === "api") {
      if (args[1].endsWith("/releases"))
        return JSON.stringify(exists ? [[{ id: 1, tag_name: "pr-review-assets" }]] : [[]]);
      if (args[1].endsWith("/assets")) return '[[{"name":"existing.png"}]]';
      return '{"id":1}';
    }
    if (args[1] === "create") exists = true;
    return "";
  };
  const options = {
    run,
    repository: "owner/repo",
    sourceCommit: "a".repeat(40),
    files: [
      { name: "existing.png", path: "/tmp/existing.png" },
      { name: "new.png", path: "/tmp/new.png" },
    ],
    request: async (url, options) => {
      requests.push([url, options.method]);
      return { ok: true };
    },
  };
  await publishScreenshotRelease(options);
  assert.equal(calls.filter((args) => args[1] === "create").length, 1);
  assert.ok(calls.find((args) => args[1] === "create").includes("--latest=false"));
  assert.equal(calls.filter((args) => args[1] === "upload").length, 1);
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every(
      ([url, method]) => url.includes("/releases/download/pr-review-assets/") && method === "HEAD",
    ),
  );
  assert.ok(calls.every((args) => args[0] === "api" || args[0] === "release"));
  assert.ok(calls.every((args) => !args.includes("--clobber")));
  await assert.rejects(
    publishScreenshotRelease({
      ...options,
      request: async () => ({ ok: false, status: 404 }),
    }),
    /not accessible: existing.png \(404\)/,
  );
  assert.equal(calls.filter((args) => args[1] === "create").length, 1);
});

test("full review releases fail before upload and explain how to rotate without deleting assets", async () => {
  const calls = [];
  await assert.rejects(
    publishScreenshotRelease({
      repository: "owner/repo",
      files: [{ name: "new.png", path: "/tmp/new.png" }],
      run: (args) => {
        calls.push(args);
        return JSON.stringify(
          args[1].endsWith("/assets")
            ? [
                Array.from({ length: 1000 }, (_, index) => ({
                  name: `${index}.png`,
                })),
              ]
            : [[{ id: 1, tag_name: "pr-review-assets" }]],
        );
      },
    }),
    /PR_SCREENSHOT_RELEASE.*next pr-review-assets-N/,
  );
  assert.ok(calls.every((args) => args[0] === "api"));
});

test("represents all 560 originals once with featured images first and a bounded PR section", () => {
  const groups = groupScreenshotGalleries(captures, featured);
  const represented = groups.flatMap((group) => [
    ...group.featured,
    ...group.sheets.flatMap((sheet) => sheet.entries),
  ]);
  assert.equal(represented.length, captures.length);
  assert.deepEqual(
    new Set(represented.map(({ file }) => file)),
    new Set(captures.map(({ file }) => file)),
  );
  for (const group of groups)
    assert.deepEqual(
      group.featured.map(({ screen }) => screen),
      featured,
    );
  const body = renderScreenshotSection({
    groups,
    assetBaseUrl: "https://github.com/owner/repo/releases/download/pr-review-assets",
    assetPrefix: "aaaaaaaaaaaa-bbbbbbbbbbbb-",
    originalArchiveUrl:
      "https://github.com/owner/repo/releases/download/pr-review-assets/aaaaaaaaaaaa-bbbbbbbbbbbb-originals.zip",
    sourceCommit: "b".repeat(40),
    fixtures: "Transfer progress is simulated.",
  });
  assert.ok(body.length < 60000);
  assert.equal((body.match(/### (Mobile|Tablet|Desktop|Ultrawide)/g) ?? []).length, 4);
  assert.equal((body.match(/<details>/g) ?? []).length, 8);
  assert.equal((body.match(/-sheet-\d+\.png\)/g) ?? []).length, 144);
  assert.ok(body.indexOf("mobile-light-0.png") < body.indexOf("mobile-light-sheet-01.png"));
  assert.match(body, /Transfer progress is simulated/);
  assert.match(
    body,
    /releases\/download\/pr-review-assets\/aaaaaaaaaaaa-bbbbbbbbbbbb-mobile-light-0.png/,
  );
  assert.match(body, /Download all full-resolution originals and galleries/);
  assert.doesNotMatch(body, /raw\.githubusercontent|\/blob\/|pr-assets\//);
  assert.throws(
    () =>
      groupScreenshotGalleries(
        [...captures, { ...captures[0], device: "Unknown", file: "other.png" }],
        featured,
      ),
    /Unsupported/,
  );
  assert.throws(() => groupScreenshotGalleries([...captures, captures[0]], featured), /unique/);
});

test("creates uncropped contact sheets and an original-resolution gallery", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ziv-gallery-test-"));
  try {
    const entries = [80, 160].map((height, index) => ({
      device: "Mobile",
      theme: "light",
      width: 80,
      height,
      screen: `screen-${index}`,
      file: `screen-${index}.png`,
    }));
    for (const entry of entries)
      await writeFile(
        path.join(directory, entry.file),
        await sharp({
          create: {
            width: 80,
            height: entry.height,
            channels: 3,
            background: "#4793ff",
          },
        })
          .png()
          .toBuffer(),
      );
    const groups = groupScreenshotGalleries(entries, []);
    const assets = await prepareScreenshotGalleries(directory, groups);
    assert.deepEqual(assets, ["mobile-light-sheet-01.png", "mobile-light-gallery.md"]);
    const metadata = await sharp(path.join(directory, assets[0])).metadata();
    assert.equal(metadata.width, 184);
    assert.ok(metadata.height > 160);
    const gallery = await readFile(path.join(directory, assets[1]), "utf8");
    for (const entry of entries)
      assert.ok(gallery.includes(`![${entry.screen.replaceAll("-", " ")}](./${entry.file})`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
