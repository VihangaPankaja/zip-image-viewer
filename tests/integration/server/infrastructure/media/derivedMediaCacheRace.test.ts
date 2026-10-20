import { expect, it, vi } from "vite-plus/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Session, VideoTranscodeEntry } from "../../../../../server/domain/models.js";
import { createDerivedMediaCache } from "../../../../../server/infrastructure/media/derivedMediaCache.js";

const removal = vi.hoisted(
  (): {
    target: string;
    wait?: Promise<void>;
    started: () => void;
    waits?: Promise<void>[];
  } => ({
    target: "",
    wait: undefined,
    started: () => undefined,
  }),
);

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rm: async (...args: Parameters<typeof fs.rm>) => {
      if (args[0] === removal.target) {
        removal.started();
        await (removal.waits?.shift() ?? removal.wait);
      }
      return fs.rm(...args);
    },
  };
});

it("serializes queued cache clears and keeps media waiting until the last removal ends", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "cache-clear-race-"));
  const finishes: (() => void)[] = [];
  const session = { id: "clear-race", workspaceDir } as Session;
  const cache = createDerivedMediaCache(new Map([[session.id, session]]), new Map(), 1_000);
  let started = 0;
  removal.target = path.join(workspaceDir, "thumbnails");
  removal.started = () => {
    started += 1;
  };
  removal.waits = Array.from(
    { length: 3 },
    () =>
      new Promise<void>((resolve) => {
        finishes.push(resolve);
      }),
  );
  const first = cache.clear(session);
  await vi.waitFor(() => expect(started).toBe(1));
  const next = [cache.clear(session), cache.clear(session)];
  try {
    finishes[0]();
    await first;
    await vi.waitFor(() => expect(started).toBe(2));
    expect(removal.waits).toHaveLength(1);
    finishes[1]();
    await vi.waitFor(() => expect(started).toBe(3));
    let admitted = false;
    const waiting = cache.waitForEviction(session.id).then(() => {
      admitted = true;
    });
    await Promise.resolve();
    expect(admitted).toBe(false);
    finishes[2]();
    await Promise.all([...next, waiting]);
    expect(admitted).toBe(true);
  } finally {
    for (const finish of finishes) finish();
    await Promise.allSettled([first, ...next]);
    removal.target = "";
    removal.waits = undefined;
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

it("waits for an ongoing eviction before admitting a newly pinned request", async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "media-race-"));
  try {
    const file = path.join(workspaceDir, "previews", "old.jpg");
    await mkdir(path.dirname(file));
    await writeFile(file, "123456");
    const session = { id: "race", workspaceDir } as Session;
    const cache = createDerivedMediaCache(
      new Map([[session.id, session]]),
      new Map<string, VideoTranscodeEntry>(),
      0,
    );
    removal.target = file;
    const started = new Promise<void>((resolve) => {
      removal.started = resolve;
    });
    let finishRemoval: () => void = () => undefined;
    removal.wait = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    const sweep = cache.enforce();
    await started;
    const release = cache.protectSession(session.id);
    let admitted = false;
    const waiting = cache.waitForEviction(session.id).then(() => {
      admitted = true;
    });
    await Promise.resolve();
    expect(admitted).toBe(false);
    finishRemoval();
    await Promise.all([sweep, waiting]);
    expect(admitted).toBe(true);
    release();
  } finally {
    removal.target = "";
    removal.wait = undefined;
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
