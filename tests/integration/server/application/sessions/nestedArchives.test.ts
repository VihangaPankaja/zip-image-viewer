import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { path7za } from "7zip-bin";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createNestedArchives } from "../../../../../server/application/sessions/nestedArchives.js";
import { createSessionManager } from "../../../../../server/application/sessions/sessionManager.js";
import { buildTree } from "../../../../../server/domain/explorerTree.js";
import type { Session } from "../../../../../server/domain/models.js";
import { listExtractedEntries } from "../../../../../server/infrastructure/archive/listExtractedEntries.js";
import * as commands from "../../../../../server/infrastructure/process/commandRunner.js";
import { zipBytes } from "../../../../fixtures/zipBytes.js";

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Required fixture value is missing.");
  return value;
}

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(limits?: Parameters<typeof createNestedArchives>[0]["limits"]) {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "nested-archives-"));
  directories.push(workspaceDir);
  const extractDir = path.join(workspaceDir, "extracted");
  const input = path.join(workspaceDir, "input");
  await mkdir(extractDir);
  await mkdir(input);
  await writeFile(path.join(input, "one.txt"), "first text");
  await writeFile(path.join(input, "two.txt"), "second text");
  await writeFile(path.join(input, "skip.txt"), "stay compressed");
  const inner = path.join(workspaceDir, "inner.7z");
  await commands.runCommand(path7za, ["a", "-t7z", inner, "."], { cwd: input });
  await writeFile(
    path.join(extractDir, "outer.zip"),
    zipBytes([
      { name: "inner.7z", data: await readFile(inner) },
      { name: "unselected.txt", data: Buffer.from("stay outside child") },
    ]),
  );
  const parent: Session = {
    id: randomUUID(),
    workspaceDir,
    extractDir,
    ...buildTree(await listExtractedEntries(extractDir), "root"),
    selectedVideoQuality: "original",
    transcodeStatus: { quality: "original", done: true, completed: 0, total: 0 },
    lastAccessedAt: 0,
  };
  const sessions = new Map([[parent.id, parent]]);
  const manager = createSessionManager(sessions, new Map(), vi.fn(), async () => {});
  const service = createNestedArchives({
    sessions,
    executable: path7za,
    removeSession: manager.removeSession,
    limits,
  });
  return { parent, sessions, service, manager, extractDir, workspaceDir };
}

it("indexes ZIP → 7z → text on demand, extracts selections only and reuses stable owned children", async () => {
  const { parent, sessions, service, manager } = await fixture();
  const inspect = vi.spyOn(commands, "inspect7zip");
  const extract = vi.spyOn(commands, "extractWith7zip");
  const outer = await service.inspect(parent.id, "outer.zip");
  expect(extract).not.toHaveBeenCalled();
  expect(await service.inspect(parent.id, "outer.zip")).toEqual(outer);
  expect(inspect).toHaveBeenCalledOnce();
  const innerEntry = required(outer.entries.find((entry) => entry.path === "inner.7z"));
  const [opened, concurrent] = await Promise.all([
    service.open(parent.id, "outer.zip", outer.fingerprint, [innerEntry.id]),
    service.open(parent.id, "outer.zip", outer.fingerprint, [innerEntry.id]),
  ]);
  expect(concurrent).toEqual(opened);
  expect(extract).toHaveBeenCalledOnce();
  const child = required(sessions.get(opened.id));
  expect(child.parentSessionId).toBe(parent.id);
  expect(await readdir(child.extractDir)).toEqual(["inner.7z"]);
  const manifest = await service.inspect(child.id, "inner.7z");
  const one = required(manifest.entries.find((entry) => entry.path === "one.txt"));
  const two = required(manifest.entries.find((entry) => entry.path === "two.txt"));
  const grandchild = await service.open(child.id, "inner.7z", manifest.fingerprint, [one.id]);
  const textSession = required(sessions.get(grandchild.id));
  expect(await readFile(path.join(textSession.extractDir, "one.txt"), "utf8")).toBe("first text");
  expect(await readdir(textSession.extractDir)).toEqual(["one.txt"]);
  const updated = await service.inspect(child.id, "inner.7z");
  expect(updated.extractedCount).toBe(1);
  expect(updated.entries.find((entry) => entry.id === one.id)?.extracted).toBe(true);
  expect(await service.open(child.id, "inner.7z", manifest.fingerprint, [one.id, two.id])).toEqual(
    grandchild,
  );
  expect(await readdir(textSession.extractDir)).toEqual(["one.txt", "two.txt"]);
  const lastOptions = extract.mock.calls.at(-1)?.[3];
  expect(lastOptions?.filePaths).toEqual(["two.txt"]);
  await manager.removeSession(parent.id);
  expect(sessions.size).toBe(0);
  expect(manager.touchSession(grandchild.id)).toBeUndefined();
  await expect(stat(textSession.workspaceDir)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  ["bytes", { bytes: 1 }, "expanded-byte"],
  ["entries", { entries: 1 }, "entry limit"],
  ["time", { timeMs: 0 }, "processing time"],
] as const)("enforces cumulative %s limits before publication", async (_name, limits, message) => {
  const { parent, service, sessions } = await fixture(limits);
  if ("bytes" in limits) {
    const manifest = await service.inspect(parent.id, "outer.zip");
    await expect(
      service.open(parent.id, "outer.zip", manifest.fingerprint, [
        required(manifest.entries[0]).id,
      ]),
    ).rejects.toThrow(message);
  } else await expect(service.inspect(parent.id, "outer.zip")).rejects.toThrow(message);
  expect(sessions.size).toBe(1);
});

it("applies the depth limit across child sessions", async () => {
  const { parent, service } = await fixture({ depth: 1 });
  const manifest = await service.inspect(parent.id, "outer.zip");
  const entry = required(manifest.entries.find((item) => item.path === "inner.7z"));
  const child = await service.open(parent.id, "outer.zip", manifest.fingerprint, [entry.id]);
  await expect(service.inspect(child.id, "inner.7z")).rejects.toThrow("depth limit");
});

it("includes top-level extraction time and subsequent Extract more work in the chain budget", async () => {
  const { parent, service } = await fixture({ timeMs: 10_000 });
  await service.inspect(parent.id, "outer.zip");
  parent.archiveProcessingMs = 10_000;
  await expect(service.inspect(parent.id, "outer.zip")).rejects.toThrow(
    "cumulative processing time",
  );
});

it("charges both outer extracted sources and inner selected text against one chain budget", async () => {
  const { parent, sessions, service, manager, extractDir } = await fixture();
  const manifest = await service.inspect(parent.id, "outer.zip");
  const inner = required(manifest.entries.find((entry) => entry.path === "inner.7z"));
  const limited = createNestedArchives({
    sessions,
    executable: path7za,
    removeSession: manager.removeSession,
    limits: { bytes: (await stat(path.join(extractDir, "outer.zip"))).size + inner.expandedBytes },
  });
  const opened = await limited.open(parent.id, "outer.zip", manifest.fingerprint, [inner.id]);
  const childManifest = await limited.inspect(opened.id, "inner.7z");
  const text = required(childManifest.entries.find((entry) => entry.path === "one.txt"));
  await expect(
    limited.open(opened.id, "inner.7z", childManifest.fingerprint, [text.id]),
  ).rejects.toThrow("cumulative expanded-byte");
  expect(sessions.size).toBe(2);
});

it("streams nested gzip members within the remaining chain budget", async () => {
  const { parent, service, extractDir, sessions } = await fixture();
  await writeFile(path.join(extractDir, "text.txt.gz"), gzipSync("nested compressed text"));
  const manifest = await service.inspect(parent.id, "text.txt.gz");
  const member = required(manifest.entries[0]);
  const opened = await service.open(parent.id, "text.txt.gz", manifest.fingerprint, [member.id]);
  expect(
    await readFile(path.join(required(sessions.get(opened.id)).extractDir, member.path), "utf8"),
  ).toBe("nested compressed text");
});

it("cancels a queued archive promptly without cancelling another active source", async () => {
  const { parent, service, extractDir } = await fixture();
  await writeFile(
    path.join(extractDir, "other.zip"),
    await readFile(path.join(extractDir, "outer.zip")),
  );
  let started = () => {};
  const indexing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const inspect = vi
    .spyOn(commands, "inspect7zip")
    .mockImplementation(async (_executable, _source, signal) => {
      started();
      await new Promise<void>((_resolve, reject) => {
        required(signal).addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      });
      throw new Error("unreachable");
    });
  const active = service.inspect(parent.id, "outer.zip").catch((error: unknown) => error);
  await indexing;
  const queued = service.inspect(parent.id, "other.zip").catch((error: unknown) => error);
  await service.cancel(parent.id, "other.zip");
  expect(await queued).toMatchObject({ name: "AbortError" });
  expect(inspect).toHaveBeenCalledOnce();
  expect(parent.archiveOperations?.size).toBe(1);
  await service.cancel(parent.id, "outer.zip");
  expect(await active).toMatchObject({ name: "AbortError" });
});

it.each(["cancel", "delete"])(
  "drains interrupted selected extraction on %s and removes staging files",
  async (action) => {
    const { parent, service, manager, workspaceDir, sessions } = await fixture();
    const manifest = await service.inspect(parent.id, "outer.zip");
    const selected = required(manifest.entries.find((entry) => entry.path === "inner.7z"));
    let started = () => {};
    const extracting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const extract = vi
      .spyOn(commands, "extractWith7zip")
      .mockImplementation(async (_executable, _source, _output, options) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          required(options?.signal).addEventListener(
            "abort",
            () => reject(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
        });
      });
    const operation = service
      .open(parent.id, "outer.zip", manifest.fingerprint, [selected.id])
      .catch((error: unknown) => error);
    await extracting;
    if (action === "cancel") await service.cancel(parent.id, "outer.zip");
    else await manager.removeSession(parent.id);
    expect(await operation).toMatchObject({ name: "AbortError" });
    expect(parent.archiveOperations?.size).toBe(0);
    expect(sessions.size).toBe(action === "cancel" ? 1 : 0);
    if (action === "cancel") {
      expect(
        (await readdir(workspaceDir, { recursive: true })).filter((name) =>
          /staging|pending/.test(name),
        ),
      ).toEqual([]);
      extract.mockRestore();
      expect(
        await service.open(parent.id, "outer.zip", manifest.fingerprint, [selected.id]),
      ).toHaveProperty("id");
    }
  },
);

it.each([
  { name: "../escape.txt", data: Buffer.from("escape") },
  { name: "link", mode: 0xa1ff, data: Buffer.from("../escape") },
  { name: "C:/escape.txt", data: Buffer.from("escape") },
])("rejects unsafe nested archive member $name", async (entry) => {
  const { parent, service, extractDir, sessions } = await fixture();
  await writeFile(path.join(extractDir, "bad.zip"), zipBytes([entry]));
  await expect(service.inspect(parent.id, "bad.zip")).rejects.toThrow(/Unsafe|links/);
  expect(sessions.size).toBe(1);
});

it("invalidates a changed source, removes its descendants and rejects stale selections", async () => {
  const { parent, service, extractDir, sessions } = await fixture();
  const manifest = await service.inspect(parent.id, "outer.zip");
  const child = await service.open(parent.id, "outer.zip", manifest.fingerprint, [
    required(manifest.entries[0]).id,
  ]);
  await writeFile(
    path.join(extractDir, "outer.zip"),
    zipBytes([{ name: "changed.txt", data: Buffer.from("changed") }]),
  );
  await expect(
    service.open(parent.id, "outer.zip", manifest.fingerprint, [required(manifest.entries[0]).id]),
  ).rejects.toThrow("Archive changed");
  expect(sessions.has(child.id)).toBe(false);
  expect(
    (await service.inspect(parent.id, "outer.zip")).entries.map((entry) => entry.path),
  ).toEqual(["changed.txt"]);
});

it("rejects invalid selection IDs and missing or escaped parent sources", async () => {
  const { parent, service, sessions } = await fixture();
  const manifest = await service.inspect(parent.id, "outer.zip");
  await expect(
    service.open(parent.id, "outer.zip", manifest.fingerprint, ["unknown"]),
  ).rejects.toThrow("Invalid archive selection");
  await expect(service.inspect(randomUUID(), "outer.zip")).rejects.toThrow("Parent session");
  await expect(service.inspect(parent.id, "../inner.7z")).rejects.toThrow(
    /Invalid archive path|Unsafe entry path/,
  );
  expect(sessions.size).toBe(1);
});

it.each(["cancel", "delete"])(
  "drains active indexing on %s without publishing a child or leaving owned files",
  async (action) => {
    const { parent, service, manager, sessions, workspaceDir } = await fixture();
    let started = () => {};
    const indexing = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(commands, "inspect7zip").mockImplementation(async (_executable, _filename, signal) => {
      started();
      await new Promise<void>((_resolve, reject) => {
        required(signal).addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      });
      throw new Error("unreachable");
    });
    const opening = service.inspect(parent.id, "outer.zip");
    const failed = opening.catch((error: unknown) => error);
    await indexing;
    if (action === "cancel") await service.cancel(parent.id, "outer.zip");
    else await manager.removeSession(parent.id);
    expect(await failed).toMatchObject({ name: "AbortError" });
    expect(parent.archiveOperations?.size).toBe(0);
    expect(sessions.size).toBe(action === "cancel" ? 1 : 0);
    if (action === "delete")
      await expect(stat(workspaceDir)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
