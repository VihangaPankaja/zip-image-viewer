import { expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import { createExtractionProgress } from "../../../../../server/application/jobs/extractionProgress.js";
import type { ExtractionProgress } from "../../../../../shared/contracts.js";

it("bounds progress events for many tiny entries while always sending stage transitions", () => {
  const job = createJobManager(new Map(), vi.fn()).createJob("https://example.com/many.zip");
  const emit = vi.fn<(_job: typeof job, _patch: Partial<typeof job>) => void>();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
  try {
    const report = createExtractionProgress(job, emit);
    const progress: ExtractionProgress = {
      stage: "extracting",
      completedEntries: 0,
      totalEntries: 1_000,
      expandedBytes: 0,
      totalExpandedBytes: 1_000,
      currentEntry: "0.txt",
    };
    report(progress);
    for (let index = 1; index < 1_000; index++)
      report({
        ...progress,
        currentEntry: `${index}.txt`,
        completedEntries: index,
        expandedBytes: index,
      });
    expect(emit).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(2_000);
    report({ ...progress, completedEntries: 999, expandedBytes: 999 });
    expect(emit).toHaveBeenCalledTimes(2);
    report({ ...progress, stage: "publishing", completedEntries: 1_000, expandedBytes: 1_000 });
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit.mock.calls.at(-1)?.[1].percent).toBe(99);
  } finally {
    clock.mockRestore();
  }
});
