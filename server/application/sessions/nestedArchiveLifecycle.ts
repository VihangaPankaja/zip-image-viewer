import { rm } from "node:fs/promises";
import path from "node:path";
import type { Session } from "../../domain/models.js";
import { resourceLimitError } from "../../infrastructure/runtime/resourceLimits.js";
import { treeUsage, rootArchiveBudget, type ArchiveBudget } from "./nestedArchiveBudget.js";

type Dependencies = {
  sessions: Map<string, Session>;
  removeSession: (_id: string, _reason: string) => Promise<void>;
  budgets: WeakMap<Session, ArchiveBudget>;
  caches: { delete: (_session: Session) => boolean };
  tails: Map<string, Promise<unknown>>;
  limits: { bytes: number; entries: number; timeMs: number };
};

function ownedSessions(root: Session, sessions: Map<string, Session>) {
  const owned = new Set([root]);
  for (const parent of owned) {
    for (const session of sessions.values()) {
      if (session.parentSessionId === parent.id) owned.add(session);
    }
  }
  return owned;
}

function refreshBudget(root: Session, processingMs: number, deps: Dependencies) {
  const prior = deps.budgets.get(root);
  const elapsed =
    (prior?.elapsed ?? root.archiveProcessingMs ?? 0) +
    Math.max(0, processingMs - (prior?.rootProcessingMs ?? root.archiveProcessingMs ?? 0));
  deps.budgets.set(root, rootArchiveBudget(root, processingMs, elapsed));
  root.archiveProcessingMs = processingMs;
}

function remainingTime(root: Session, processingMs: number, deps: Dependencies) {
  const budget = deps.budgets.get(root);
  const elapsed =
    (budget?.elapsed ?? root.archiveProcessingMs ?? 0) +
    Math.max(0, processingMs - (budget?.rootProcessingMs ?? root.archiveProcessingMs ?? 0));
  const remaining = deps.limits.timeMs - elapsed;
  if (remaining <= 0)
    throw resourceLimitError("Refreshed archive exceeds the cumulative processing time limit.");
  return remaining;
}

export function installArchiveLifecycle(root: Session, deps: Dependencies) {
  let invalidated = false;
  root.archiveLifecycle = {
    remaining: (processingMs) => remainingTime(root, processingMs, deps),
    invalidate: async (refreshOperation) => {
      invalidated = false;
      const owned = ownedSessions(root, deps.sessions);
      const operations = [
        ...new Set(
          [...owned]
            .flatMap((session) => [...(session.archiveOperations ?? [])])
            .filter((operation) => operation !== refreshOperation),
        ),
      ];
      for (const operation of operations) operation.controller.abort();
      await Promise.allSettled(operations.map((operation) => operation.done));
      for (const session of owned) {
        if (session.parentSessionId === root.id)
          await deps.removeSession(session.id, "parent-refresh");
      }
      await deps.tails.get(root.id);
      deps.tails.delete(root.id);
      deps.caches.delete(root);
      await rm(path.join(root.workspaceDir, ".nested-archives"), { recursive: true, force: true });
      invalidated = true;
      refreshBudget(root, root.archiveProcessingMs ?? 0, deps);
    },
    admit: (tree, processingMs) => {
      const usage = treeUsage(tree);
      if (usage.bytes > deps.limits.bytes)
        throw resourceLimitError(
          "Refreshed archive exceeds the cumulative expanded-byte and disk limit.",
        );
      if (usage.entries > deps.limits.entries)
        throw resourceLimitError("Refreshed archive exceeds the cumulative entry limit.");
      remainingTime(root, processingMs, deps);
    },
    finish: (processingMs) => {
      if (invalidated) refreshBudget(root, processingMs, deps);
    },
  };
}
