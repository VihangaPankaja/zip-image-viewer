import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { createDerivedMediaCache } from "./derivedMediaCache.js";

const workspaces: string[] = [];
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function session(id: string): Promise<Session> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "media-budget-"));
  workspaces.push(workspaceDir);
  const extractDir = path.join(workspaceDir, "extracted");
  await mkdir(extractDir);
  await writeFile(path.join(extractDir, "original.mp4"), "original");
  return { id, workspaceDir, extractDir } as Session;
}

async function cachedFile(
  filePath: string,
  content: string,
  ageMs: number,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  const modifiedAt = new Date(Date.now() - ageMs);
  await utimes(filePath, modifiedAt, modifiedAt);
  await utimes(path.dirname(filePath), modifiedAt, modifiedAt);
}

it("evicts the oldest completed rendition across sessions without removing originals or stale rendition state", async () => {
  const first = await session("first");
  const second = await session("second");
  const renditionDir = path.join(first.workspaceDir, "video-transcodes", "old");
  const rendition = {
    dir: renditionDir,
    status: "done",
    availableSegments: 1,
  } as VideoRendition;
  await cachedFile(
    path.join(renditionDir, "segment_000000.m4s"),
    "123456",
    20_000,
  );
  const thumbnail = path.join(
    second.workspaceDir,
    "video-thumbnails",
    "new.jpg",
  );
  await cachedFile(thumbnail, "abcdef", 1_000);
  const sessions = new Map([
    [first.id, first],
    [second.id, second],
  ]);
  const transcodes = new Map<string, VideoTranscodeEntry>([
    [
      "first:video",
      {
        sessionId: first.id,
        renditions: new Map([["360p", rendition]]),
      } as VideoTranscodeEntry,
    ],
  ]);
  await createDerivedMediaCache(sessions, transcodes, 6).enforce();
  await expect(
    readFile(path.join(renditionDir, "segment_000000.m4s")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(rendition.status).toBe("idle");
  expect(rendition.availableSegments).toBe(0);
  expect(await readFile(thumbnail, "utf8")).toBe("abcdef");
  expect(
    await readFile(path.join(first.extractDir, "original.mp4"), "utf8"),
  ).toBe("original");
  expect(
    await readFile(path.join(second.extractDir, "original.mp4"), "utf8"),
  ).toBe("original");
});

it("keeps in-flight reads and recently requested HLS segments while evicting unused files", async () => {
  const active = await session("active");
  const playing = await session("playing");
  const idle = await session("idle");
  const activeFile = path.join(active.workspaceDir, "previews", "active.jpg");
  const playingDir = path.join(
    playing.workspaceDir,
    "video-transcodes",
    "playing",
  );
  const playingFile = path.join(playingDir, "segment_000000.m4s");
  const idleFile = path.join(idle.workspaceDir, "thumbnails", "idle.jpg");
  await cachedFile(activeFile, "aaaa", 30_000);
  await cachedFile(playingFile, "bbbb", 20_000);
  await cachedFile(idleFile, "cccc", 10_000);
  const rendition = {
    dir: playingDir,
    status: "done",
    lastAccessedAt: Date.now(),
  } as VideoRendition;
  const cache = createDerivedMediaCache(
    new Map([
      [active.id, active],
      [playing.id, playing],
      [idle.id, idle],
    ]),
    new Map([
      [
        "playing:video",
        {
          sessionId: playing.id,
          renditions: new Map([["360p", rendition]]),
        } as VideoTranscodeEntry,
      ],
    ]),
    8,
  );
  const release = cache.protectSession(active.id);
  await cache.enforce();
  release();
  expect(await readFile(activeFile, "utf8")).toBe("aaaa");
  expect(await readFile(playingFile, "utf8")).toBe("bbbb");
  await expect(readFile(idleFile)).rejects.toMatchObject({ code: "ENOENT" });
});
