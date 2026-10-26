import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vite-plus/test";
import { createJobManager } from "../../server/application/jobs/jobManager.js";
import { downloadSessionSource } from "../../server/application/jobs/downloadSessionSource.js";
import { normalizeDownloadSettings } from "../../server/application/downloads/downloadOptions.js";

vi.mock("../../server/config/runtimeConstants.js", async (original) => ({
  ...(await original<typeof import("../../server/config/runtimeConstants.js")>()),
  CONFIRM_SIZE_BYTES: 64,
}));

it("requires confirmation for a verified oversized source after cancellation or a completion-checkpoint crash", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "verified-confirm-"));
  const zipPath = path.join(directory, "source.bin");
  const bytes = Buffer.alloc(128, 7);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const manager = createJobManager(new Map(), vi.fn());
  const job = manager.createJob("https://example.com/file.bin");
  job.httpDownload = {
    originalUrl: job.url,
    resolvedUrl: job.url,
    size: 128,
    validator: "",
    files: [{ index: -1, start: 0, end: 127, bytes: 128, sha256: hash }],
    completedSha256: hash,
  };
  job.abortController = new AbortController();
  const deps = {
    emitJob: manager.emitJob,
    closeJob: manager.closeJob,
    download: () => Promise.reject(new Error("A verified source should not download again")),
  };
  const input = { url: job.url, zipPath, workspaceDir: directory, confirmOversize: false };
  try {
    await writeFile(zipPath, bytes);
    expect(await downloadSessionSource(job, normalizeDownloadSettings({}), input, deps)).toBe(
      "paused",
    );
    expect(job).toMatchObject({
      status: "awaiting_confirmation",
      requiresConfirmation: true,
      reportedSize: 128,
    });
    input.confirmOversize = true;
    expect(await downloadSessionSource(job, normalizeDownloadSettings({}), input, deps)).toBe(
      "complete",
    );
    expect(job.httpDownload.completedSha256).toBe(hash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
