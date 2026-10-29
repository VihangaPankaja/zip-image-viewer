import { buildTree, type ExtractedEntry } from "../../domain/explorerTree.js";
import { ApplicationError, type Session, type SessionJob } from "../../domain/models.js";
import { resourceLimitError } from "../../infrastructure/runtime/resourceLimits.js";

export async function refreshArchiveSession<Result>(
  session: Session | undefined,
  job: SessionJob,
  operation: (_admit: (_entries: ExtractedEntry[]) => void) => Promise<Result>,
): Promise<Result> {
  if (!session) return operation(() => {});
  if (session.archiveRefreshing)
    throw new ApplicationError("CONFLICT", "Archive contents are already being refreshed.", 409);
  session.archiveLifecycle?.remaining(job.archiveProcessingMs ?? 0);
  session.archiveRefreshing = true;
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  job.abortController ??= new AbortController();
  const item = { controller: job.abortController, done };
  session.archiveOperations ??= new Set();
  session.archiveOperations.add(item);
  let timer: NodeJS.Timeout | undefined;
  const previousProcessingMs = job.archiveProcessingMs ?? 0;
  let started: number | undefined;
  try {
    await session.archiveLifecycle?.invalidate(item);
    item.controller.signal.throwIfAborted();
    const remaining = session.archiveLifecycle?.remaining(job.archiveProcessingMs ?? 0);
    const operationStarted = Date.now();
    started = operationStarted;
    if (remaining !== undefined) {
      timer = setTimeout(
        () =>
          item.controller.abort(
            resourceLimitError("Refreshed archive exceeds the cumulative processing time limit."),
          ),
        remaining,
      );
      timer.unref();
    }
    return await operation((entries) => {
      item.controller.signal.throwIfAborted();
      const processingMs = previousProcessingMs + Date.now() - operationStarted;
      session.archiveLifecycle?.admit(buildTree(entries, "").tree, processingMs);
    });
  } catch (error) {
    item.controller.signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
    // Whole-operation accounting includes failed indexing/verification and replaces sub-step charges once.
    if (started !== undefined)
      job.archiveProcessingMs = previousProcessingMs + Date.now() - started;
    session.archiveLifecycle?.finish(job.archiveProcessingMs ?? 0);
    session.archiveProcessingMs = job.archiveProcessingMs ?? 0;
    session.archiveRefreshing = false;
    session.archiveOperations.delete(item);
    finish();
  }
}
