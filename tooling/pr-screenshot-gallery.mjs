import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const devices = ["Mobile", "Tablet", "Desktop", "Ultrawide"];
const themes = ["light", "dark"];
const label = (entry) => entry.screen.replaceAll("-", " ");

export function groupScreenshotGalleries(captures, featuredScreens) {
  assert.equal(
    new Set(captures.map(({ file }) => file)).size,
    captures.length,
    "Screenshot filenames must be unique.",
  );
  for (const capture of captures)
    assert.ok(
      devices.includes(capture.device) && themes.includes(capture.theme),
      "Unsupported screenshot device or theme.",
    );
  const rank = new Map(featuredScreens.map((screen, index) => [screen, index]));
  const groups = [];
  for (const device of devices)
    for (const theme of themes) {
      const entries = captures
        .filter(
          (capture) => capture.device === device && capture.theme === theme,
        )
        .sort(
          (a, b) =>
            (rank.get(a.screen) ?? Infinity) - (rank.get(b.screen) ?? Infinity),
        );
      if (!entries.length) continue;
      const prefix = `${device.toLowerCase()}-${theme}`;
      const standard = entries.filter(({ screen }) => !rank.has(screen));
      const sheets = [];
      for (let index = 0; index < standard.length; index += 8)
        sheets.push({
          file: `${prefix}-sheet-${String(sheets.length + 1).padStart(2, "0")}.png`,
          entries: standard.slice(index, index + 8),
        });
      groups.push({
        device,
        theme,
        width: entries[0].width,
        height: entries[0].height,
        entries,
        featured: entries.filter(({ screen }) => rank.has(screen)),
        sheets,
        galleryFile: `${prefix}-gallery.md`,
      });
    }
  const represented = groups.flatMap((group) => [
    ...group.featured,
    ...group.sheets.flatMap((sheet) => sheet.entries),
  ]);
  assert.deepEqual(
    represented.map(({ file }) => file).sort(),
    captures.map(({ file }) => file).sort(),
    "Every screenshot must appear exactly once in the PR gallery.",
  );
  const generated = groups.flatMap((group) => [
    group.galleryFile,
    ...group.sheets.map(({ file }) => file),
  ]);
  assert.ok(
    generated.every(
      (file) => !captures.some((capture) => capture.file === file),
    ),
    "Generated gallery files must not overwrite original screenshots.",
  );
  return groups;
}

function caption(text, width, dark) {
  const lines = [];
  const length = Math.max(8, Math.floor((width - 24) / 9));
  for (const word of text.split(" ")) {
    if (lines.length && lines.at(-1).length + word.length + 1 <= length)
      lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  const escape = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const height = lines.length * 22 + 16;
  return {
    height,
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${dark ? "#181b22" : "#f2f4f7"}"/><text font-family="Arial,sans-serif" font-size="16" fill="${dark ? "#ffffff" : "#111827"}">${lines.map((line, index) => `<tspan x="12" y="${24 + index * 22}">${escape(line)}</tspan>`).join("")}</text></svg>`,
    ),
  };
}

async function contactSheet(directory, group, sheet) {
  const width = Math.min(group.width, 720);
  const gap = 8;
  const tiles = [];
  for (const [index, entry] of sheet.entries.entries()) {
    const image = await sharp(await readFile(path.join(directory, entry.file)))
      .resize({ width, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    tiles.push({
      image,
      title: caption(
        `${index + 1}. ${label(entry)}`,
        width,
        group.theme === "dark",
      ),
    });
  }
  const layers = [];
  let top = gap;
  for (let row = 0; row < tiles.length; row += 2) {
    const pair = tiles.slice(row, row + 2);
    for (const [column, tile] of pair.entries()) {
      const left = gap + column * (width + gap);
      layers.push(
        { input: tile.title.input, left, top },
        { input: tile.image.data, left, top: top + tile.title.height },
      );
    }
    top +=
      Math.max(
        ...pair.map((tile) => tile.title.height + tile.image.info.height),
      ) + gap;
  }
  await sharp({
    create: {
      width: width * 2 + gap * 3,
      height: top,
      channels: 3,
      background: group.theme === "dark" ? "#181b22" : "#f2f4f7",
    },
  })
    .composite(layers)
    .png()
    .toFile(path.join(directory, sheet.file));
}

export async function prepareScreenshotGalleries(directory, groups) {
  const assets = [];
  for (const group of groups) {
    for (const sheet of group.sheets) {
      await contactSheet(directory, group, sheet);
      assets.push(sheet.file);
    }
    const lines = [
      `# ${group.device} · ${group.theme} theme`,
      "",
      "Full-resolution original screenshots. Transfer progress is simulated.",
      "",
    ];
    for (const entry of group.entries)
      lines.push(
        `## ${label(entry)}`,
        "",
        `[Open original](./${entry.file})`,
        "",
        `![${label(entry)}](./${entry.file})`,
        "",
      );
    await writeFile(path.join(directory, group.galleryFile), lines.join("\n"));
    assets.push(group.galleryFile);
  }
  return assets;
}

export function renderScreenshotSection({
  groups,
  assetBaseUrl,
  assetPrefix,
  originalArchiveUrl,
  sourceCommit,
  fixtures,
}) {
  const assetUrl = (file) => `${assetBaseUrl}/${assetPrefix}${file}`;
  const lines = [
    "## Screenshots",
    "",
    `Captured from \`${sourceCommit}\`. ${fixtures}`,
    "",
  ];
  for (const device of devices) {
    const entries = groups.filter((group) => group.device === device);
    if (!entries.length) continue;
    lines.push(
      `### ${device} · ${entries[0].width} × ${entries[0].height}`,
      "",
    );
    for (const group of entries) {
      lines.push(
        `<details><summary>${group.theme === "light" ? "Light" : "Dark"} theme</summary>`,
        "",
      );
      for (const entry of group.featured)
        lines.push(`![${label(entry)}](${assetUrl(entry.file)})`, "");
      lines.push(
        `[Download all full-resolution originals and galleries](${originalArchiveUrl})`,
        "",
        "All remaining screenshots are included below. Click a sheet to open it at full size.",
        "",
      );
      for (const [index, sheet] of group.sheets.entries())
        lines.push(
          `[![${group.device} ${group.theme} gallery sheet ${index + 1}](${assetUrl(sheet.file)})](${assetUrl(sheet.file)})`,
          "",
        );
      lines.push("</details>", "");
    }
  }
  const section = lines.join("\n");
  assert.ok(
    section.length < 60000,
    "Screenshot section must stay below 60000 characters to leave room for the PR description.",
  );
  return section;
}
