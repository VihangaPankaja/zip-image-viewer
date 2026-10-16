import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  utimes,
  writeFile,
  link,
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

it("evicts completed preparation output while preventing a manual clear of pending work", async () => {
  const item = await session("preparing");
  const file = path.join(item.workspaceDir, "video-quality", "completed.mp4");
  await cachedFile(file, "completed output", 0);
  const cache = createDerivedMediaCache(
    new Map([[item.id, item]]),
    new Map(),
    0,
  );
  const release = cache.protectSession(item.id, true);
  await cache.enforce();
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(cache.clear(item)).rejects.toMatchObject({ status: 409 });
  release();
  await expect(cache.clear(item)).resolves.toBeUndefined();
  expect(
    await readFile(path.join(item.extractDir, "original.mp4"), "utf8"),
  ).toBe("original");
});

it("reports separate storage totals and clears derived files without deleting originals", async () => {
  const item = await session("storage");
  await cachedFile(
    path.join(item.workspaceDir, "previews", "image.jpg"),
    "preview",
    0,
  );
  await cachedFile(
    path.join(item.workspaceDir, "video-quality", "clip.mp4"),
    "remux",
    0,
  );
  const transcodes = new Map<string, VideoTranscodeEntry>();
  const cache = createDerivedMediaCache(
    new Map([[item.id, item]]),
    transcodes,
    1_000,
  );
  expect(await cache.storage(item)).toEqual({
    originalsBytes: 8,
    previewsBytes: 7,
    transcodesBytes: 5,
  });
  await cache.clear(item);
  expect(await cache.storage(item)).toEqual({
    originalsBytes: 8,
    previewsBytes: 0,
    transcodesBytes: 0,
  });
  expect(
    await readFile(path.join(item.extractDir, "original.mp4"), "utf8"),
  ).toBe("original");
});

it("counts retained torrent hardlinks once in storage totals", async () => {
  const item = await session("hardlinks");
  await link(
    path.join(item.extractDir, "original.mp4"),
    path.join(item.workspaceDir, "original-link.mp4"),
  );
  const cache = createDerivedMediaCache(
    new Map([[item.id, item]]),
    new Map(),
    1_000,
  );
  expect((await cache.storage(item)).originalsBytes).toBe(8);
});

it("refuses cache cleanup during media work or recent HLS playback", async () => {
  const item = await session("active");
  const rendition = {
    status: "done",
    lastAccessedAt: Date.now(),
  } as VideoRendition;
  const entry = {
    sessionId: item.id,
    renditions: new Map([["360p", rendition]]),
  } as VideoTranscodeEntry;
  const cache = createDerivedMediaCache(
    new Map([[item.id, item]]),
    new Map([["clip", entry]]),
    1_000,
  );
  const release = cache.protectSession(item.id);
  await expect(cache.clear(item)).rejects.toThrow("Media is active");
  release();
  await expect(cache.clear(item)).rejects.toThrow("Media is active");
  rendition.lastAccessedAt = Date.now() - 31_000;
  await cache.clear(item);
});

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

it("honors a rendition registered after a sweep starts", async () => {
  const current = await session("late-rendition");
  const renditionDir = path.join(
    current.workspaceDir,
    "video-transcodes",
    "late",
  );
  const segment = path.join(renditionDir, "segment_000000.m4s");
  await cachedFile(segment, "123456", 20_000);
  const transcodes = new Map<string, VideoTranscodeEntry>();
  const cache = createDerivedMediaCache(
    new Map([[current.id, current]]),
    transcodes,
    0,
  );
  const sweep = cache.enforce();
  const rendition = {
    dir: renditionDir,
    status: "running",
  } as VideoRendition;
  transcodes.set("late:video", {
    sessionId: current.id,
    renditions: new Map([["360p", rendition]]),
  } as VideoTranscodeEntry);
  await sweep;
  expect(await readFile(segment, "utf8")).toBe("123456");
  expect(rendition.status).toBe("running");
});
