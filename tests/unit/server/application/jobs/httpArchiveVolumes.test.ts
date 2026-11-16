import { expect, test, vi } from "vite-plus/test";
import type { SessionJob } from "../../../../../server/domain/models.js";
import { createJobManager } from "../../../../../server/application/jobs/jobManager.js";
import {
  groupHttpArchiveDownloads,
  httpVolumeSources,
  supplyHttpVolumes,
} from "../../../../../server/application/jobs/httpArchiveVolumes.js";

test("invalid volume filenames cannot leave an unqueued job in the job store", () => {
  const jobs = new Map<string, SessionJob>();
  const manager = createJobManager(jobs, vi.fn());
  expect(() => manager.createJob("https://example.com/folder%2Fbook.7z.001")).toThrow();
  expect(jobs.size).toBe(0);
});

test("a large set can receive additional batches beyond the 50-URL request limit", () => {
  const job = createJobManager(new Map(), vi.fn()).createJob("https://example.com/book.7z.001");
  job.volumeSources = httpVolumeSources(
    Array.from(
      { length: 50 },
      (_, i) => `https://example.com/book.7z.${String(i + 1).padStart(3, "0")}`,
    ),
  );
  job.status = "awaiting_volumes";
  supplyHttpVolumes(job, ["https://example.com/book.7z.051"]);
  expect(job.volumeSources).toHaveLength(51);
  expect(job.status).toBe("queued");
});

test("rejects an invalid volume group before the batch starts creating jobs", () => {
  expect(() =>
    groupHttpArchiveDownloads([
      { url: "https://example.com/good.zip", sourcePreference: "auto" },
      { url: "https://example.com/book.7z.001", sourcePreference: "auto" },
      { url: "https://example.com/book.7z.001", sourcePreference: "auto" },
    ]),
  ).toThrow(/one URL per archive volume/);
});
