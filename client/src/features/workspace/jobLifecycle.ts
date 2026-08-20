import type { JobPayload, OversizePrompt } from "./sessionSchemas";

export type JobSnapshotAction =
  | { kind: "progress" }
  | { kind: "awaiting_confirmation"; prompt: OversizePrompt }
  | { kind: "ready" }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

export function getJobSnapshotAction(payload: JobPayload): JobSnapshotAction {
  if (payload.status === "awaiting_confirmation") {
    return {
      kind: "awaiting_confirmation",
      prompt: {
        jobId: payload.id,
        reportedSize: payload.reportedSize ?? 0,
        limit: 1024 * 1024 * 1024,
      },
    };
  }
  if (payload.status === "ready") return { kind: "ready" };
  if (payload.status === "error") {
    return {
      kind: "error",
      message:
        typeof payload.error === "string"
          ? payload.error
          : "Could not process this file.",
    };
  }
  if (payload.status === "cancelled") return { kind: "cancelled" };
  return { kind: "progress" };
}
