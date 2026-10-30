import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import type { ArchiveManifest } from "../../../shared/contracts.js";
import { ApplicationError, type Session } from "../../domain/models.js";
import {
  resolveArchiveSource,
  fingerprintArchive,
} from "../../infrastructure/archive/nestedArchiveSource.js";
import { inspectZip } from "../../infrastructure/archive/zipManifest.js";
import { summarizeArchive } from "../../infrastructure/archive/archiveSummary.js";
import { inspect7zip } from "../../infrastructure/process/commandRunner.js";
import {
  MAX_RESOURCE_BYTES,
  resourceLimitError,
} from "../../infrastructure/runtime/resourceLimits.js";
import { sanitizeEntryPath } from "../../infrastructure/runtime/runtimePrimitives.js";

import {
  treeUsage,
  waitForPrevious,
  rootArchiveBudget,
  type ArchiveBudget,
} from "./nestedArchiveBudget.js";
import { publishNestedSelection, type NestedArchiveRecord } from "./nestedArchiveSelection.js";
import { installArchiveLifecycle } from "./nestedArchiveLifecycle.js";

type Dependencies = {
  sessions: Map<string, Session>;
  executable: string;
  removeSession: (_id: string, _reason: string) => Promise<void>;
  limits?: { bytes?: number; entries?: number; depth?: number; timeMs?: number };
};

export function createNestedArchives(deps: Dependencies) {
  const service = new NestedArchives(deps);
  return {
    inspect: service.inspect.bind(service),
    open: service.open.bind(service),
    cancel: service.cancel.bind(service),
  };
}

class NestedArchives {
  private readonly limits;
  constructor(private readonly deps: Dependencies) {
    this.limits = {
      bytes: MAX_RESOURCE_BYTES,
      entries: 10_000,
      depth: 8,
      timeMs: 5 * 60_000,
      ...deps.limits,
    };
  }
  private readonly caches = new WeakMap<Session, Map<string, NestedArchiveRecord>>();
  private readonly budgets = new WeakMap<Session, ArchiveBudget>();
  private readonly refreshRoots = new WeakSet<Session>();
  private readonly pending = new Map<
    string,
    Set<{ controller: AbortController; done: Promise<unknown> }>
  >();
  private readonly tails = new Map<string, Promise<unknown>>();

  private ancestry(id: string) {
    const parent = this.deps.sessions.get(id);
    if (!parent)
      throw new ApplicationError("NOT_FOUND", "Parent session is no longer available.", 404);
    let root = parent;
    let depth = 1;
    while (root.parentSessionId) {
      const ancestor = this.deps.sessions.get(root.parentSessionId);
      if (!ancestor)
        throw new ApplicationError("NOT_FOUND", "Parent session is no longer available.", 404);
      root = ancestor;
      ancestor.lastAccessedAt = Date.now();
      depth++;
    }
    if (root.archiveRefreshing)
      throw new ApplicationError(
        "CONFLICT",
        "Parent archive contents are being refreshed. Try again when extraction finishes.",
        409,
      );
    if (!this.refreshRoots.has(root)) {
      installArchiveLifecycle(root, {
        ...this.deps,
        caches: this.caches,
        budgets: this.budgets,
        tails: this.tails,
        limits: this.limits,
      });
      this.refreshRoots.add(root);
    }
    if (depth > this.limits.depth)
      throw resourceLimitError(
        `Nested archives exceed the ${this.limits.depth} level depth limit.`,
      );
    let budget = this.budgets.get(root);
    if (!budget) {
      budget = rootArchiveBudget(root);
      this.budgets.set(root, budget);
    } else {
      const usage = treeUsage(root.tree);
      budget.bytes += Math.max(0, usage.bytes - budget.rootBytes);
      budget.entries += Math.max(0, usage.entries - budget.rootEntries);
      budget.elapsed += Math.max(0, (root.archiveProcessingMs ?? 0) - budget.rootProcessingMs);
      budget.rootBytes = usage.bytes;
      budget.rootEntries = usage.entries;
      budget.rootProcessingMs = root.archiveProcessingMs ?? 0;
    }
    parent.lastAccessedAt = root.lastAccessedAt = Date.now();
    return { parent, root, budget };
  }

  private async cached(
    parent: Session,
    relativePath: string,
    budget: ArchiveBudget,
    signal: AbortSignal,
  ) {
    const filename = await resolveArchiveSource(parent, relativePath);
    const hash = await fingerprintArchive(filename, signal);
    const records = this.caches.get(parent) ?? new Map<string, NestedArchiveRecord>();
    this.caches.set(parent, records);
    let record = records.get(relativePath);
    if (record?.fingerprint === hash) {
      if (record.childId && !this.deps.sessions.has(record.childId)) {
        record.childId = undefined;
        record.extracted.clear();
      }
      return { record, filename };
    }
    if (record?.childId) await this.deps.removeSession(record.childId, "source-changed");
    if (record) await rm(record.directory, { recursive: true, force: true });
    records.delete(relativePath);
    const detected = await fileTypeFromFile(filename);
    if (detected?.ext === "zip") await inspectZip(filename, signal);
    signal.throwIfAborted();
    const index = await inspect7zip(this.deps.executable, filename, signal);
    if (budget.entries + index.entryCount > this.limits.entries)
      throw resourceLimitError("Nested archives exceed the cumulative entry limit.");
    const entries = index.entries.map((entry, position) => ({
      id: String(position),
      path: sanitizeEntryPath(entry.path),
      type: entry.directory ? ("directory" as const) : ("file" as const),
      compressedBytes: entry.compressedSize,
      expandedBytes: entry.size,
      extracted: false,
    }));
    const manifest: ArchiveManifest = {
      fingerprint: hash,
      sourceBytes: (await stat(filename)).size,
      entries,
      ...summarizeArchive(entries),
    };
    const directory = path.join(
      parent.workspaceDir,
      ".nested-archives",
      createHash("sha256").update(relativePath).digest("hex"),
    );
    try {
      // Child IDs are process-local; discard interrupted or previous-process output before rebuilding its index.
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "index.json"), JSON.stringify({ manifest, index }), {
        signal,
      });
      signal.throwIfAborted();
      if (this.deps.sessions.get(parent.id) !== parent)
        throw new ApplicationError("NOT_FOUND", "Parent session was deleted.", 404);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    record = { fingerprint: hash, manifest, index, extracted: new Set(), directory };
    budget.entries += index.entryCount;
    records.set(relativePath, record);
    return { record, filename };
  }

  private async run<Result>(
    id: string,
    relativePath: string,
    operation: (
      _parent: Session,
      _budget: ArchiveBudget,
      _signal: AbortSignal,
      _track: (_session: Session) => void,
    ) => Promise<Result>,
  ): Promise<Result> {
    const { parent, root, budget } = this.ancestry(id);
    const key = `${id}:${relativePath}`;
    const controller = new AbortController();
    const previous = this.tails.get(root.id);
    const done = (async () => {
      await waitForPrevious(previous, controller.signal);
      controller.signal.throwIfAborted();
      this.ancestry(id);
      const started = Date.now();
      if (budget.elapsed >= this.limits.timeMs)
        throw resourceLimitError("Nested archives exceed the cumulative processing time limit.");
      const timer = setTimeout(
        () =>
          controller.abort(
            resourceLimitError("Nested archives exceed the cumulative processing time limit."),
          ),
        this.limits.timeMs - budget.elapsed,
      );
      timer.unref();
      try {
        return await operation(parent, budget, controller.signal, track);
      } finally {
        clearTimeout(timer);
        budget.elapsed += Date.now() - started;
      }
    })();
    const item = { controller, done };
    const owners = new Set<Session>();
    function track(session: Session) {
      session.archiveOperations ??= new Set();
      session.archiveOperations.add(item);
      owners.add(session);
    }
    const items = this.pending.get(key) ?? new Set();
    items.add(item);
    this.pending.set(key, items);
    track(parent);
    // Serialize work owned by one root so concurrent opens share its processing-time budget.
    const barrier = Promise.allSettled([previous, done]).then(() => undefined);
    this.tails.set(root.id, barrier);
    void barrier.then(() => {
      if (this.tails.get(root.id) === barrier) this.tails.delete(root.id);
    });
    void done
      .finally(() => {
        items.delete(item);
        for (const owner of owners) owner.archiveOperations?.delete(item);
        if (!items.size) this.pending.delete(key);
      })
      .catch(() => undefined);
    return done;
  }

  inspect(id: string, relativePath: string) {
    relativePath = relativePath.replaceAll("\\", "/");
    return this.run(id, relativePath, async (parent, budget, signal) => {
      const { record } = await this.cached(parent, relativePath, budget, signal);
      return {
        ...record.manifest,
        entries: record.manifest.entries.map((entry) => ({
          ...entry,
          extracted: record.extracted.has(entry.id),
        })),
        extractedCount: record.extracted.size,
      };
    });
  }
  private selection(record: NestedArchiveRecord, expectedFingerprint: string, fileIds: string[]) {
    if (record.fingerprint !== expectedFingerprint)
      throw new ApplicationError("CONFLICT", "Archive changed. Review its contents again.", 409);
    const ids = new Set(fileIds);
    const files = record.manifest.entries.filter(
      (entry) => ids.has(entry.id) && entry.type === "file",
    );
    if (!ids.size || ids.size !== fileIds.length || files.length !== ids.size)
      throw new ApplicationError("INVALID_INPUT", "Invalid archive selection.", 400);
    return files.filter((entry) => !record.extracted.has(entry.id));
  }
  open(id: string, relativePath: string, expectedFingerprint: string, fileIds: string[]) {
    relativePath = relativePath.replaceAll("\\", "/");
    return this.run(id, relativePath, async (parent, budget, signal, track) => {
      const { record, filename } = await this.cached(parent, relativePath, budget, signal);
      const selected = this.selection(record, expectedFingerprint, fileIds);
      // Gzip metadata reports modulo sizes, so reserve the remaining chain budget until actual output is known.
      const bytes =
        record.index.gzip && selected.length
          ? this.limits.bytes - budget.bytes
          : selected.reduce((total, entry) => total + entry.expandedBytes, 0);
      if (bytes < 0 || budget.bytes + bytes > this.limits.bytes)
        throw resourceLimitError(
          "Nested archives exceed the cumulative expanded-byte and disk limit.",
        );
      budget.bytes += bytes;
      try {
        const result = await publishNestedSelection({
          parent,
          record,
          selected,
          filename,
          signal,
          track,
          bytes,
          sessions: this.deps.sessions,
          executable: this.deps.executable,
        });
        budget.bytes -= bytes - result.expandedBytes;
        return { id: result.id };
      } catch (error) {
        budget.bytes -= bytes;
        throw error;
      }
    });
  }
  async cancel(id: string, relativePath: string) {
    relativePath = relativePath.replaceAll("\\", "/");
    const items = [...(this.pending.get(`${id}:${relativePath}`) ?? [])];
    for (const item of items) item.controller.abort();
    await Promise.allSettled(items.map((item) => item.done));
  }
}
