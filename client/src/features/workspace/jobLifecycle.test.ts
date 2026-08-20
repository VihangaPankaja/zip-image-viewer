import { describe, expect, it } from "vitest";
import { getJobSnapshotAction } from "./jobLifecycle";

describe("job snapshot actions", () => {
  it("requests confirmation without stopping job updates", () => {
    expect(
      getJobSnapshotAction({
        id: "job-1",
        status: "awaiting_confirmation",
        reportedSize: 2_048,
      }),
    ).toEqual({
      kind: "awaiting_confirmation",
      prompt: {
        jobId: "job-1",
        reportedSize: 2_048,
        limit: 1024 * 1024 * 1024,
      },
    });
  });

  it("normalizes terminal and in-progress updates", () => {
    expect(getJobSnapshotAction({ id: "ready", status: "ready" })).toEqual({
      kind: "ready",
    });
    expect(
      getJobSnapshotAction({ id: "cancelled", status: "cancelled" }),
    ).toEqual({ kind: "cancelled" });
    expect(
      getJobSnapshotAction({ id: "working", status: "extracting" }),
    ).toEqual({ kind: "progress" });
  });

  it("uses a stable fallback for non-string job errors", () => {
    expect(getJobSnapshotAction({ id: "failed", status: "error" })).toEqual({
      kind: "error",
      message: "Could not process this file.",
    });
  });
});
