import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONFIRM_SIZE_BYTES } from "../../config/runtimeConstants.js";
import { normalizeDownloadSettings } from "../downloads/downloadOptions.js";
import { createJobManager } from "./jobManager.js";
import {
  downloadSessionSource,
  type DownloadSourceDependencies,
} from "./downloadSessionSource.js";

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), sleep: vi.fn() }));
vi.mock("../../infrastructure/downloads/remoteMetadata.js", () => ({
  fetchRemoteMetadata: mocks.metadata,
}));
vi.mock(
  "../../infrastructure/runtime/mediaClassification.js",
  async (original) => ({
    ...(await original<
      typeof import("../../infrastructure/runtime/mediaClassification.js")
    >()),
    sleepWithSignal: mocks.sleep,
  }),
);

const workspaces: string[] = [];
beforeEach(() => {
  mocks.metadata.mockResolvedValue({
    size: 100,
    acceptRanges: true,
    etag: "",
    lastModified: "",
  });
  mocks.sleep.mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    workspaces
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function setup(overrides = {}) {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "download-source-"));
  workspaces.push(workspaceDir);
  const manager = createJobManager(new Map(), vi.fn());
  const job = manager.createJob("https://example.com/archive.zip");
  job.abortController = new AbortController();
  const settings = normalizeDownloadSettings(overrides);
  const download = vi
    .fn<DownloadSourceDependencies["download"]>()
    .mockResolvedValue(undefined);
  const deps = {
    emitJob: manager.emitJob,
    closeJob: manager.closeJob,
    download,
  };
  const input = {
    url: job.url,
    zipPath: path.join(workspaceDir, "archive.zip"),
    workspaceDir,
    confirmOversize: false,
  };
  return {
    job,
    download,
    input,
    settings,
    run: () => downloadSessionSource(job, settings, input, deps),
  };
}

it.each([
  [{}, true, "segmented", 3, true],
  [{ enableMultithread: false }, true, "single", 1, true],
  [{}, false, "single", 1, false],
  [{ threadMode: "single", enableResume: false }, true, "single", 1, false],
])(
  "selects transport capabilities from settings and remote metadata (%j)",
  async (settings, ranges, mode, threads, resume) => {
    const test = await setup(settings);
    mocks.metadata.mockResolvedValue({ size: 100, acceptRanges: ranges });
    test.download.mockImplementation(({ state }) => {
      state.downloadedBytes = 100;
      return Promise.resolve();
    });
    await expect(test.run()).resolves.toBe("complete");
    expect(test.job).toMatchObject({
      threadMode: mode,
      threadCount: threads,
      canResume: resume,
      canPause: resume,
      downloadedBytes: 100,
      percent: 100,
    });
  },
);

it("waits for confirmation before downloading a known oversized archive", async () => {
  const test = await setup();
  mocks.metadata.mockResolvedValue({
    size: CONFIRM_SIZE_BYTES + 1,
    acceptRanges: true,
  });
  await expect(test.run()).resolves.toBe("paused");
  expect(test.download).not.toHaveBeenCalled();
  expect(test.job).toMatchObject({
    status: "awaiting_confirmation",
    requiresConfirmation: true,
  });
  await expect(stat(test.input.workspaceDir)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("continues an oversized archive after explicit confirmation", async () => {
  const test = await setup();
  test.input.confirmOversize = true;
  mocks.metadata.mockResolvedValue({
    size: CONFIRM_SIZE_BYTES + 1,
    acceptRanges: true,
  });
  await expect(test.run()).resolves.toBe("complete");
  expect(test.download).toHaveBeenCalledOnce();
});

it("pauses when streaming discovers an oversized archive", async () => {
  const test = await setup();
  test.download.mockImplementation(({ state }) => {
    state.downloadedBytes = CONFIRM_SIZE_BYTES + 1;
    return Promise.reject(
      Object.assign(new Error("Confirm size"), {
        code: "OVERSIZE_CONFIRM",
      }),
    );
  });
  await expect(test.run()).resolves.toBe("paused");
  expect(test.job.reportedSize).toBe(CONFIRM_SIZE_BYTES + 1);
  expect(mocks.sleep).not.toHaveBeenCalled();
});

it.each([408, 429, 500, undefined])(
  "retries a transient failure (%s) and completes",
  async (statusCode) => {
    const test = await setup({ maxRetries: 1 });
    test.download.mockRejectedValueOnce(
      Object.assign(new Error("Temporary failure"), { statusCode }),
    );
    await expect(test.run()).resolves.toBe("complete");
    expect(test.download).toHaveBeenCalledTimes(2);
    expect(test.job.retryCount).toBe(1);
    expect(mocks.sleep).toHaveBeenCalledOnce();
  },
);

it.each([
  { statusCode: 404 },
  { code: "DOWNLOAD_FATAL" },
  { name: "AbortError" },
])("does not retry permanent or aborted failures (%j)", async (details) => {
  const test = await setup();
  const error = Object.assign(new Error("Stop download"), details);
  test.download.mockRejectedValue(error);
  await expect(test.run()).rejects.toBe(error);
  expect(test.download).toHaveBeenCalledOnce();
  expect(mocks.sleep).not.toHaveBeenCalled();
});

it("stops at the retry budget and propagates the original failure", async () => {
  const test = await setup({ maxRetries: 1 });
  const error = new Error("Connection closed");
  test.download.mockRejectedValue(error);
  await expect(test.run()).rejects.toBe(error);
  expect(test.download).toHaveBeenCalledTimes(2);
  expect(mocks.sleep).toHaveBeenCalledOnce();
});

it("allows unlimited retries until success", async () => {
  const test = await setup({ maxRetries: -1 });
  test.download
    .mockRejectedValueOnce("offline")
    .mockRejectedValueOnce("offline");
  await expect(test.run()).resolves.toBe("complete");
  expect(test.download).toHaveBeenCalledTimes(3);
});
