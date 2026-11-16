import type { SessionJob } from "../../domain/models.js";
import { ArchiveVolumesRequired } from "../../infrastructure/archive/archiveVolumes.js";

export function waitForArchiveVolumes(
  job: SessionJob,
  error: unknown,
  emit: (_job: SessionJob, _patch: Partial<SessionJob>) => void,
) {
  if (!(error instanceof ArchiveVolumesRequired) || job.abortController?.signal.aborted)
    return false;
  emit(job, {
    status: "awaiting_volumes",
    phase: "volumes",
    percent: null,
    extraction: undefined,
    canPause: false,
    canResume: false,
    downloadSpeedBytesPerSec: 0,
    averageSpeedBytesPerSec: 0,
    etaSeconds: null,
    error: "",
    volumes: {
      names: job.volumeSources?.map((source) => source.name) ?? [],
      missing: error.missing,
    },
    message:
      job.sourceKind === "torrent"
        ? `${error.message} Add a complete torrent if these parts are absent from its file list.`
        : error.message,
  });
  return true;
}

type FailureDependencies = {
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>, _event?: string) => void;
  closeJob: (_job: SessionJob, _status: SessionJob["status"]) => void;
};

export function emitFailure(job: SessionJob, error: Error, deps: FailureDependencies): void {
  if (error.name === "AbortError") {
    deps.emitJob(
      job,
      {
        status: "cancelled",
        phase: "cancelled",
        error: "",
        extraction: job.extraction ? { ...job.extraction, stage: "cancelling" } : undefined,
        message: job.extraction
          ? "Extraction cancelled. Partial output was removed; the source is kept for Retry."
          : "Archive loading was cancelled.",
      },
      "cancelled",
    );
    deps.closeJob(job, "cancelled");
    return;
  }
  deps.emitJob(
    job,
    {
      status: "error",
      phase: "error",
      error: error.message || "Could not process this file.",
      message: error.message || "Could not process this file.",
    },
    "job-error",
  );
  deps.closeJob(job, "error");
}
