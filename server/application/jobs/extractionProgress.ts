import type { ExtractionProgress } from "../../../shared/contracts.js";
import { rm } from "node:fs/promises";
import { PROGRESS_EMIT_INTERVAL_MS } from "../../config/runtimeConstants.js";
import type { SessionJob } from "../../domain/models.js";

export function createExtractionProgress(
  job: SessionJob,
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void,
) {
  let previous: ExtractionProgress | undefined;
  let lastEmit = 0;
  return (progress: ExtractionProgress): void => {
    job.abortController?.signal.throwIfAborted();
    const now = Date.now();
    if (previous?.stage === progress.stage && now - lastEmit < PROGRESS_EMIT_INTERVAL_MS) return;
    const ratio = progress.totalExpandedBytes
      ? progress.expandedBytes / progress.totalExpandedBytes
      : progress.totalExpandedBytes === 0 && progress.totalEntries
        ? progress.completedEntries / progress.totalEntries
        : null;
    const labels = {
      indexing: "Indexing archive contents",
      checking: "Checking archive and selected files",
      extracting: "Extracting archive",
      publishing: "Checking finished output and publishing files",
      cancelling: "Cancelling extraction and removing partial files",
    };
    emitJob(job, {
      status: "extracting",
      phase: ["indexing", "checking"].includes(progress.stage) ? "indexing" : "extracting",
      extraction: { ...progress },
      extractedEntries: progress.completedEntries,
      totalEntries: progress.totalEntries ?? 0,
      percent: ratio === null ? null : Math.min(99, Math.floor(ratio * 100)),
      downloadSpeedBytesPerSec: 0,
      etaSeconds: null,
      canPause: false,
      canResume: false,
      message: labels[progress.stage],
    });
    job.abortController?.signal.throwIfAborted();
    previous = { ...progress };
    lastEmit = now;
  };
}

export function startArchiveInspection(
  job: SessionJob,
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void,
  stage: "indexing" | "checking",
) {
  createExtractionProgress(
    job,
    emitJob,
  )({
    stage,
    completedEntries: 0,
    totalEntries: null,
    expandedBytes: 0,
    totalExpandedBytes: null,
    currentEntry: "",
  });
}

export async function restoreExtractionCancellation(job: SessionJob): Promise<void> {
  if (job.extraction?.stage !== "cancelling") return;
  await rm(`${job.extractDir}.staging`, { recursive: true, force: true });
  Object.assign(job, {
    status: "cancelled",
    phase: "cancelled",
    extraction: undefined,
    canPause: false,
    canResume: false,
    percent: null,
    message: "Extraction cancelled. Partial output was removed; the source is kept for Retry.",
  });
}
