import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { VideoStoryboard } from "../../shared/contracts.js";

export function storyboardDirectory(
  workspace: string,
  videoPath: string,
): string {
  return path.join(
    workspace,
    "video-storyboards",
    crypto.createHash("sha1").update(videoPath).digest("hex"),
  );
}

export function storyboardIndex(durationSeconds: number): VideoStoryboard {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
    throw new Error("Video duration is unavailable.");
  // ponytail: cap at 240 frames; increase only if long-clip preview detail needs it.
  const intervalSeconds = Math.max(5, durationSeconds / 240);
  const frameCount = Math.min(
    240,
    Math.ceil(durationSeconds / intervalSeconds),
  );
  return {
    intervalSeconds,
    width: 320,
    height: 180,
    columns: 5,
    rows: 5,
    frames: Array.from({ length: frameCount }, (_, index) => ({
      time: index * intervalSeconds,
      sheet: Math.floor(index / 25),
      x: (index % 5) * 320,
      y: Math.floor((index % 25) / 5) * 180,
    })),
  };
}

export async function generateStoryboard(
  directory: string,
  targetPath: string,
  durationSeconds: number,
  run: (_args: string[]) => Promise<void>,
): Promise<VideoStoryboard> {
  const cached = await readFile(
    path.join(directory, "index.json"),
    "utf8",
  ).catch(() => null);
  if (cached) return JSON.parse(cached) as VideoStoryboard;
  const index = storyboardIndex(durationSeconds);
  const pending = `${directory}.pending`;
  await mkdir(pending, { recursive: true });
  try {
    await run([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      targetPath,
      "-an",
      "-vf",
      `fps=1/${String(index.intervalSeconds)}:start_time=0:round=up,scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,tile=5x5`,
      "-frames:v",
      String(Math.ceil(index.frames.length / 25)),
      "-q:v",
      "4",
      path.join(pending, "sheet-%d.jpg"),
    ]);
    for (
      let sheet = 1;
      sheet <= Math.ceil(index.frames.length / 25);
      sheet += 1
    ) {
      if (!(await stat(path.join(pending, `sheet-${String(sheet)}.jpg`))).size)
        throw new Error("Storyboard sheet is empty.");
    }
    await writeFile(path.join(pending, "index.json"), JSON.stringify(index));
    await rename(pending, directory);
    return index;
  } finally {
    await rm(pending, { recursive: true, force: true });
  }
}
