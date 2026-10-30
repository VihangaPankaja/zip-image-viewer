import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { SpawnOptions } from "node:child_process";
import path from "node:path";
import { path7za } from "7zip-bin";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import {
  createProcessSessionJob,
  restoreTorrentSession,
} from "../../../../../server/application/jobs/processSessionJob.js";
import { createNestedArchives } from "../../../../../server/application/sessions/nestedArchives.js";
import { createSessionManager } from "../../../../../server/application/sessions/sessionManager.js";
import type { Session } from "../../../../../server/domain/models.js";
import { inspectZip } from "../../../../../server/infrastructure/archive/zipManifest.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";
import * as commands from "../../../../../server/infrastructure/process/commandRunner.js";
import * as archiveSelection from "../../../../../server/application/jobs/archiveSelection.js";
import * as zipManifest from "../../../../../server/infrastructure/archive/zipManifest.js";
import { zipBytes } from "../../../../fixtures/zipBytes.js";
import { restorePublishedArchiveSession } from "../../../../../server/application/jobs/restorePublishedArchiveSession.js";
import {
  detectRuntimeArchiveEncryption,
  extractRuntimeArchive,
} from "../../../../../server/runtimeAdapters.js";

const schedule = vi.hoisted(() => ({
  beforeMkdir: undefined as ((_path: string) => Promise<void> | void) | undefined,
}));
const native = vi.hoisted(() => ({
  phase: "none" as "none" | "detect" | "extract",
  ready: () => {},
  closed: false,
  signals: [] as (AbortSignal | undefined)[],
}));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: SpawnOptions) => {
      if (command !== "root-deadline-extractor") return actual.spawn(command, args, options);
      const hold = args[0] === "l" ? native.phase === "detect" : native.phase === "extract";
      const output =
        args[0] === "l" ? "----------\nPath = one.txt\nSize = 5\nPacked Size = 5\n\n" : "1";
      const script = `process.stdout.write(${JSON.stringify(output)});${hold ? "setInterval(() => {}, 1000)" : ""}`;
      const child = actual.spawn(process.execPath, ["-e", script], options);
      native.signals.push(options.signal);
      if (hold) {
        child.once("spawn", () => native.ready());
        child.once("close", () => {
          native.closed = true;
        });
      }
      return child;
    },
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (
      directory: Parameters<typeof actual.mkdir>[0],
      options?: Parameters<typeof actual.mkdir>[1],
    ) => {
      await schedule.beforeMkdir?.(String(directory));
      return actual.mkdir(directory, options);
    },
  };
});
vi.mock("../../../../../server/application/jobs/downloadSessionSource.js", () => ({
  downloadSessionSource: () => Promise.resolve("ready"),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  native.phase = "none";
  native.closed = false;
  native.signals = [];
  schedule.beforeMkdir = undefined;
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Required fixture value is missing.");
  return value;
}

async function fixture(limits?: Parameters<typeof createNestedArchives>[0]["limits"]) {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "archive-refresh-"));
  directories.push(workspaceDir);
  const extractDir = path.join(workspaceDir, "extracted");
  await mkdir(extractDir);
  const nested = zipBytes([
    { name: "one.txt", data: Buffer.from("12345") },
    { name: "two.txt", data: Buffer.from("67890") },
  ]);
  const zipPath = path.join(workspaceDir, "source.zip");
  await writeFile(
    zipPath,
    zipBytes([
      { name: "nested.zip", data: nested },
      ...["growth.txt", "more.txt", "extra.txt"].map((name) => ({
        name,
        data: Buffer.from("root grows"),
      })),
    ]),
  );
  const manifest = await inspectZip(zipPath);
  const nestedEntry = required(manifest.entries.find((entry) => entry.path === "nested.zip"));
  const manager = createJobManager(new Map(), vi.fn());
  const job = manager.createJob("https://example.com/source.zip");
  Object.assign(job, {
    workspaceDir,
    extractDir,
    zipPath,
    archive: manifest,
    zipSelection: {
      fingerprint: manifest.fingerprint,
      selectedIds: [nestedEntry.id],
      extractedIds: [],
    },
  });
  const sessions = new Map<string, Session>();
  const deps: Parameters<typeof createProcessSessionJob>[0] = {
    sessionStore: sessions,
    emitJob: manager.emitJob,
    closeJob: manager.closeJob,
    download: vi.fn(),
    detectEncryption: () => Promise.resolve(false),
    extractWith7zip: (source, output) => commands.extractWith7zip(path7za, source, output),
    listExtractedEntries,
    torrentAdapter: { download: vi.fn(), close: vi.fn() },
    logEvent: vi.fn(),
  };
  const process = createProcessSessionJob(deps);
  await process(job);
  expect(job.status).toBe("ready");
  const parent = required(sessions.get(job.sessionId));
  const lifecycle = createSessionManager(sessions, new Map(), vi.fn(), async () => {});
  const service = createNestedArchives({
    sessions,
    executable: path7za,
    removeSession: lifecycle.removeSession,
    limits: { bytes: nested.length + 5, ...limits },
  });
  const childManifest = await service.inspect(parent.id, "nested.zip");
  const one = required(childManifest.entries.find((entry) => entry.path === "one.txt"));
  const two = required(childManifest.entries.find((entry) => entry.path === "two.txt"));
  const child = await service.open(parent.id, "nested.zip", childManifest.fingerprint, [one.id]);
  return {
    deps,
    parent,
    sessions,
    service,
    lifecycle,
    process,
    job,
    manifest,
    childManifest,
    one,
    two,
    child,
    extractDir,
    workspaceDir,
  };
}

it.each([
  ["bytes", {}, "expanded-byte"],
  ["entries", { bytes: 10_000, entries: 3 }, "entry limit"],
  ["time", { bytes: 10_000, timeMs: 100_000 }, "processing time"],
] as const)(
  "rejects root Extract more before publication when the refreshed chain exceeds %s",
  async (kind, limits, message) => {
    const { parent, sessions, service, process, job, manifest, child, extractDir } =
      await fixture(limits);
    const oldTree = parent.tree;
    const original = await readFile(path.join(extractDir, "nested.zip"));
    if (kind === "time") job.archiveProcessingMs = 100_000;
    required(job.zipSelection).selectedIds = manifest.entries.map((entry) => entry.id);
    await process(job);
    expect(job.status).toBe("error");
    expect(job.error).toContain(message);
    expect(sessions.get(parent.id)).toBe(parent);
    expect(parent.tree).toBe(oldTree);
    expect(await readdir(extractDir)).toEqual(["nested.zip"]);
    expect(await readFile(path.join(extractDir, "nested.zip"))).toEqual(original);
    expect(sessions.has(child.id)).toBe(kind === "time");
    expect(!!parent.archiveRefreshing).toBe(false);
    if (kind !== "time")
      expect((await service.inspect(parent.id, "nested.zip")).extractedCount).toBe(0);
  },
);

it("drains concurrent child extraction and blocks new nested work until the parent replacement publishes", async () => {
  const {
    parent,
    sessions,
    service,
    process,
    job,
    manifest,
    child,
    childManifest,
    two,
    extractDir,
  } = await fixture({ bytes: 10_000 });
  let started = () => {};
  const extracting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const extract = vi
    .spyOn(commands, "extractWith7zip")
    .mockImplementation(async (_command, _source, _output, options) => {
      started();
      await new Promise<void>((_resolve, reject) =>
        required(options?.signal).addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        ),
      );
    });
  const extending = service
    .open(parent.id, "nested.zip", childManifest.fingerprint, [two.id])
    .catch((error: unknown) => error);
  await extracting;
  let reachedStage = () => {};
  const staging = new Promise<void>((resolve) => {
    reachedStage = resolve;
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  schedule.beforeMkdir = async (directory) => {
    if (directory !== `${extractDir}.staging`) return;
    reachedStage();
    await gate;
  };
  required(job.zipSelection).selectedIds = manifest.entries.map((entry) => entry.id);
  const refreshing = process(job);
  await staging;
  expect(await extending).toMatchObject({ name: "AbortError" });
  expect(sessions.has(child.id)).toBe(false);
  await expect(service.inspect(parent.id, "nested.zip")).rejects.toThrow("being refreshed");
  release();
  await refreshing;
  expect(job.status).toBe("ready");
  expect(parent.stats.fileCount).toBe(4);
  expect(parent.archiveRefreshing).toBe(false);
  extract.mockRestore();
  expect((await service.inspect(parent.id, "nested.zip")).extractedCount).toBe(0);
});

it("does not resurrect an owned child deleted immediately before extension creates its output directory", async () => {
  const { parent, sessions, service, lifecycle, child, childManifest, one, two } = await fixture({
    bytes: 10_000,
  });
  const previous = required(sessions.get(child.id));
  let deletion: Promise<void> | undefined;
  schedule.beforeMkdir = (directory) => {
    if (directory !== previous.extractDir) return;
    schedule.beforeMkdir = undefined;
    deletion = lifecycle.removeSession(child.id);
  };
  await expect(
    service.open(parent.id, "nested.zip", childManifest.fingerprint, [two.id]),
  ).rejects.toMatchObject({ name: "AbortError" });
  await deletion;
  expect(sessions.has(child.id)).toBe(false);
  expect(previous.archiveOperations?.size).toBe(0);
  await expect(stat(previous.workspaceDir)).rejects.toMatchObject({ code: "ENOENT" });
  const restoredManifest = await service.inspect(parent.id, "nested.zip");
  expect(restoredManifest.extractedCount).toBe(0);
  expect(restoredManifest.entries.every((entry) => !entry.extracted)).toBe(true);
  const reopened = await service.open(parent.id, "nested.zip", childManifest.fingerprint, [
    one.id,
    two.id,
  ]);
  expect(reopened.id).not.toBe(child.id);
  expect(await readdir(required(sessions.get(reopened.id)).extractDir)).toEqual([
    "one.txt",
    "two.txt",
  ]);
});

it("rejects torrent Extract more through the same staged chain admission", async () => {
  const { parent, sessions, child, job, manifest, deps, extractDir, workspaceDir } =
    await fixture();
  const oldTree = parent.tree;
  const torrentDir = path.join(workspaceDir, "torrent");
  await mkdir(torrentDir);
  const source = await readFile(job.zipPath);
  await writeFile(path.join(torrentDir, "library.zip"), source);
  job.sourceKind = "torrent";
  job.torrentArchivePath = "library.zip";
  job.torrentFiles = [
    {
      id: "archive",
      path: "library.zip",
      size: source.length,
      selected: true,
      complete: true,
      downloadedBytes: source.length,
    },
  ];
  required(job.zipSelection).selectedIds = manifest.entries.map((entry) => entry.id);
  await expect(restoreTorrentSession(job, deps)).rejects.toThrow("cumulative expanded-byte");
  expect(sessions.get(parent.id)).toBe(parent);
  expect(parent.tree).toBe(oldTree);
  expect(await readdir(extractDir)).toEqual(["nested.zip"]);
  expect(sessions.has(child.id)).toBe(false);
  expect(parent.archiveRefreshing).toBe(false);
});

it("keeps the root deleted when removal overlaps its replacement staging", async () => {
  const { parent, sessions, lifecycle, process, job, manifest, extractDir, workspaceDir } =
    await fixture({ bytes: 10_000 });
  let deletion: Promise<void> | undefined;
  schedule.beforeMkdir = (directory) => {
    if (directory !== `${extractDir}.staging`) return;
    schedule.beforeMkdir = undefined;
    deletion = lifecycle.removeSession(parent.id);
  };
  required(job.zipSelection).selectedIds = manifest.entries.map((entry) => entry.id);
  await process(job);
  await deletion;
  expect(job.status).toBe("cancelled");
  expect(sessions.size).toBe(0);
  await expect(stat(workspaceDir)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["http", "torrent", "published"] as const)(
  "rejects exhausted %s root refresh before indexing or extraction",
  async (source) => {
    const { parent, sessions, child, job, deps, process, workspaceDir, extractDir } = await fixture(
      { bytes: 10_000, timeMs: 100_000 },
    );
    const originalTree = parent.tree;
    parent.archiveProcessingMs = job.archiveProcessingMs = 100_000;
    const extract = vi.spyOn(commands, "extractWith7zip");
    const beforeStage = vi.fn();
    schedule.beforeMkdir = (directory) => {
      if (directory.endsWith(".staging")) beforeStage();
    };
    if (source === "http") {
      await process(job);
      expect(job.status).toBe("error");
      expect(job.error).toContain("processing time");
    } else {
      if (source === "torrent") {
        const torrentDir = path.join(workspaceDir, "torrent");
        await mkdir(torrentDir);
        const payload = await readFile(job.zipPath);
        await writeFile(path.join(torrentDir, "source.zip"), payload);
        job.sourceKind = "torrent";
        job.torrentArchivePath = "source.zip";
        job.torrentFiles = [
          {
            id: "archive",
            path: "source.zip",
            size: payload.length,
            selected: true,
            complete: true,
            downloadedBytes: payload.length,
          },
        ];
      }
      const restoring =
        source === "torrent"
          ? restoreTorrentSession(job, deps)
          : restorePublishedArchiveSession(job, deps);
      await expect(restoring).rejects.toThrow("processing time");
    }
    expect(extract).not.toHaveBeenCalled();
    expect(beforeStage).not.toHaveBeenCalled();
    expect(parent.tree).toBe(originalTree);
    expect(sessions.has(child.id)).toBe(true);
    expect(await readdir(extractDir)).toEqual(["nested.zip"]);
  },
);

it.each([
  ["http", "detect"],
  ["http", "extract"],
  ["torrent", "detect"],
  ["torrent", "extract"],
] as const)(
  "aborts and drains %s root native %s at the remaining chain deadline",
  async (source, phase) => {
    const {
      parent,
      sessions,
      job,
      deps,
      process: processJob,
      workspaceDir,
      extractDir,
    } = await fixture({ bytes: 10_000, timeMs: 10_000 });
    const oldTree = parent.tree;
    const input = path.join(workspaceDir, "native-input");
    await mkdir(input);
    await writeFile(path.join(input, "one.txt"), "12345");
    const archive = path.join(workspaceDir, "native.7z");
    await commands.runCommand(path7za, ["a", "-t7z", archive, "."], { cwd: input });
    job.archive = undefined;
    job.zipSelection = undefined;
    job.zipPath = archive;
    job.url = "https://example.com/native.7z";
    if (source === "torrent") {
      const torrentDir = path.join(workspaceDir, "torrent");
      await mkdir(torrentDir);
      const payload = await readFile(archive);
      await writeFile(path.join(torrentDir, "native.7z"), payload);
      job.sourceKind = "torrent";
      job.torrentArchivePath = "native.7z";
      job.torrentFiles = [
        {
          id: "archive",
          path: "native.7z",
          size: payload.length,
          selected: true,
          complete: true,
          downloadedBytes: payload.length,
        },
      ];
    }
    deps.detectEncryption = (filename, signal) =>
      detectRuntimeArchiveEncryption("root-deadline-extractor", filename, signal);
    deps.extractWith7zip = (filename, output, signal) =>
      extractRuntimeArchive("root-deadline-extractor", filename, output, signal);
    const detecting = vi.spyOn(deps, "detectEncryption");
    const extracting = vi.spyOn(deps, "extractWith7zip");
    native.phase = phase;
    const started = new Promise<void>((resolve) => {
      native.ready = resolve;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const operation = source === "http" ? processJob(job) : restoreTorrentSession(job, deps);
    const settled = operation.catch((error: unknown) => error);
    await started;
    expect(native.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(10_001);
    const result = await settled;
    if (source === "http") {
      expect(job.status).toBe("error");
      expect(job.error).toContain("processing time");
    } else {
      expect(result).toMatchObject({ code: "DOWNLOAD_FATAL" });
      expect(String(result)).toContain("processing time");
    }
    expect(native.closed).toBe(true);
    expect(native.signals.every((signal) => signal?.aborted)).toBe(true);
    expect(detecting.mock.calls[0]?.[1]).toBe(job.abortController?.signal);
    if (phase === "extract")
      expect(extracting.mock.calls[0]?.[2]).toBe(job.abortController?.signal);
    expect(sessions.get(parent.id)).toBe(parent);
    expect(parent.tree).toBe(oldTree);
    expect(parent.archiveRefreshing).toBe(false);
    expect(await readdir(extractDir)).toEqual(["nested.zip"]);
    expect(await stat(`${extractDir}.staging`).catch(() => undefined)).toBeUndefined();
    const calls = native.signals.length;
    job.abortController = new AbortController();
    if (source === "http") {
      await processJob(job);
      expect(job.error).toContain("processing time");
    } else await expect(restoreTorrentSession(job, deps)).rejects.toThrow("processing time");
    expect(native.signals).toHaveLength(calls);
  },
);

it.each(["manifest", "verification", "listing"] as const)(
  "charges failed published-root %s time and rejects a fresh retry without repeating work",
  async (phase) => {
    const { parent, sessions, job, deps, extractDir } = await fixture({
      bytes: 10_000,
      timeMs: 10_000,
    });
    const oldTree = parent.tree;
    const before = job.archiveProcessingMs ?? 0;
    const allowance = required(parent.archiveLifecycle).remaining(before);
    let started = () => {};
    const blocked = new Promise<void>((resolve) => {
      started = resolve;
    });
    const block = () =>
      new Promise<never>((_resolve, reject) => {
        required(job.abortController ?? undefined).signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
        started();
      });
    const blocking =
      phase === "manifest"
        ? vi.spyOn(archiveSelection, "getArchiveManifest").mockImplementation(block)
        : phase === "verification"
          ? vi.spyOn(zipManifest, "verifyZipOutput").mockImplementation(block)
          : vi.spyOn(deps, "listExtractedEntries").mockImplementation(block);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const restoring = restorePublishedArchiveSession(job, deps).catch((error: unknown) => error);
    await blocked;
    await vi.advanceTimersByTimeAsync(10_001);
    expect(String(await restoring)).toContain("processing time");
    expect(job.archiveProcessingMs).toBeGreaterThanOrEqual(before + allowance);
    expect(parent.archiveProcessingMs).toBe(job.archiveProcessingMs);
    expect(sessions.get(parent.id)).toBe(parent);
    expect(parent.tree).toBe(oldTree);
    expect(await readdir(extractDir)).toEqual(["nested.zip"]);
    job.abortController = new AbortController();
    await expect(restorePublishedArchiveSession(job, deps)).rejects.toThrow("processing time");
    expect(blocking).toHaveBeenCalledOnce();
  },
);
