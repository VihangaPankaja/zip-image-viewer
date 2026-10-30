import type { Session } from "../../domain/models.js";

export type ArchiveBudget = {
  bytes: number;
  entries: number;
  elapsed: number;
  rootBytes: number;
  rootEntries: number;
  rootProcessingMs: number;
};

export function treeUsage(node: Session["tree"]): { bytes: number; entries: number } {
  const total = {
    bytes: node.type === "file" ? (node.size ?? 0) : 0,
    entries: node.path === "." ? 0 : 1,
  };
  for (const child of node.children ?? []) {
    const usage = treeUsage(child);
    total.bytes += usage.bytes;
    total.entries += usage.entries;
  }
  return total;
}

export function rootArchiveBudget(
  root: Session,
  processingMs = root.archiveProcessingMs ?? 0,
  elapsed = processingMs,
): ArchiveBudget {
  const usage = treeUsage(root.tree);
  return {
    ...usage,
    elapsed,
    rootBytes: usage.bytes,
    rootEntries: usage.entries,
    rootProcessingMs: processingMs,
  };
}

export async function waitForPrevious(previous: Promise<unknown> | undefined, signal: AbortSignal) {
  signal.throwIfAborted();
  if (!previous) return;
  let abort = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () =>
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Archive operation cancelled."),
        );
      signal.addEventListener("abort", abort, { once: true });
      void previous.then(
        () => resolve(),
        () => resolve(),
      );
    });
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
