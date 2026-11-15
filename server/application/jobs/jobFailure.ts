import type { SessionJob } from "../../domain/models.js";

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
