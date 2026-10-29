import { call, ORPCError } from "@orpc/server";
import express from "express";
import request from "supertest";
import { registerRpc } from "../../../../server/rpc/registerRpc.js";
import { describe, expect, it, vi } from "vite-plus/test";
import { ApplicationError } from "../../../../server/domain/models.js";
import { jobSchema, type Job, type TorrentLimits } from "../../../../shared/contracts.js";
import {
  createServerRpcRouter,
  type ServerRpcDependencies,
} from "../../../../server/rpc/serverRouter.js";

function job(id = "2bf886fc-65bf-4e2f-b973-b607766b3131"): Job {
  return jobSchema.parse({
    id,
    url: "https://example.com/archive.zip",
    status: "queued",
    phase: "queued",
    percent: 0,
    canPause: false,
    queuePosition: 0,
    createdAt: 1,
    updatedAt: 1,
  });
}

function dependencies(): ServerRpcDependencies {
  return {
    archives: { get: vi.fn(), select: vi.fn() },
    storage: {
      get: () =>
        Promise.resolve({
          originalsBytes: 8,
          previewsBytes: 0,
          transcodesBytes: 0,
          retained: false,
          pinned: false,
        }),
      clear: () => Promise.resolve(),
      pin: () => {},
    },
    videoQualities: vi.fn(() =>
      Promise.resolve({
        path: "clip.mp4",
        source: { width: 1280, height: 720, durationSeconds: 30 },
        options: [{ id: "source", label: "Original", height: null }],
        defaultQuality: "source",
      }),
    ),
    listJobs: () => [job()],
    listSessions: () => [],
    createJob: vi.fn(() => job()),
    enqueueJobs: vi.fn((input: { items: Array<{ url: string }> }) => input.items.map(() => job())),
    getSession: () => undefined,
    cancelJob: vi.fn((): Job => ({
      ...job(),
      status: "cancelled",
      phase: "cancelled",
    })),
    confirmJob: vi.fn((): Job => ({
      ...job(),
      status: "queued",
      phase: "queued",
      requiresConfirmation: false,
    })),
    selectFiles: vi.fn(() => job()),
    setFilePriority: vi.fn(() => job()),
    retryJob: vi.fn(() => job("f86946a1-bcf7-4137-87c6-51502024367a")),
    pauseJob: vi.fn((): Job => ({
      ...job(),
      status: "paused",
      phase: "paused",
    })),
    resumeJob: vi.fn(() => job()),
    removeJob: vi.fn(() => undefined),
    reorderJobs: vi.fn(() => [job()]),
    getSchedulerSettings: vi.fn(() => ({ activeCount: 0, maxConcurrent: 2 })),
    updateSchedulerSettings: vi.fn(() => ({
      activeCount: 0,
      maxConcurrent: 4,
    })),
    getTorrentLimits: vi.fn(() => ({
      downloadBytesPerSec: 0,
      uploadBytesPerSec: 0,
    })),
    updateTorrentLimits: vi.fn((limits: TorrentLimits) => limits),
    removeSession: vi.fn(() => undefined),
  };
}

describe("createServerRpcRouter", () => {
  it("maps blocked session and job deletions to public RPC conflicts", async () => {
    const deps = dependencies();
    const conflict = new ApplicationError(
      "CONFLICT",
      "Pause or cancel this download before deleting its files.",
      409,
    );
    vi.mocked(deps.removeSession).mockRejectedValue(conflict);
    vi.mocked(deps.removeJob).mockRejectedValue(conflict);
    const router = createServerRpcRouter(deps);
    for (const procedure of [router.sessions.remove, router.jobs.remove]) {
      const failure = call(procedure, { id: job().id });
      await expect(failure).rejects.toBeInstanceOf(ORPCError);
      await expect(failure).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        message: conflict.message,
      });
    }
    const app = express();
    app.use(express.json());
    registerRpc(app, deps);
    for (const endpoint of ["sessions", "jobs"]) {
      const response = await request(app)
        .post(`/rpc/${endpoint}/remove`)
        .send({ json: { id: job().id } })
        .expect(409);
      expect(response.body).toMatchObject({
        json: { code: "CONFLICT", message: conflict.message },
      });
    }
  });
  it("validates storage controls and returns recoverable media conflicts", async () => {
    const deps = dependencies();
    const pin = vi.spyOn(deps.storage, "pin");
    const router = createServerRpcRouter(deps);
    const id = job().id;
    await expect(call(router.storage.get, { id })).resolves.toMatchObject({
      originalsBytes: 8,
      pinned: false,
    });
    await call(router.storage.pin, { id, pinned: true });
    expect(pin).toHaveBeenCalledWith(id, true);
    await expect(call(router.storage.pin, { id: "invalid", pinned: true })).rejects.toThrow();
    expect(pin).toHaveBeenCalledOnce();
    vi.spyOn(deps.storage, "clear").mockRejectedValue(
      new ApplicationError("CONFLICT", "Media is active.", 409),
    );
    await expect(call(router.storage.clear, { id })).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: "Media is active.",
    });
    vi.spyOn(deps.storage, "get").mockRejectedValue(
      new ApplicationError("NOT_FOUND", "Session not found.", 404),
    );
    await expect(call(router.storage.get, { id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
  it("lists jobs through an executable contract procedure", async () => {
    const router = createServerRpcRouter(dependencies());
    await expect(call(router.jobs.list, undefined)).resolves.toEqual({
      items: [job()],
    });
  });

  it("validates and enqueues a URL batch", async () => {
    const deps = dependencies();
    const router = createServerRpcRouter(deps);
    const result = await call(router.jobs.enqueue, {
      items: [{ url: "https://example.com/one.zip" }, { url: "https://example.com/two.zip" }],
      confirmOversize: false,
    });
    expect(result.items).toHaveLength(2);
    expect(deps.enqueueJobs).toHaveBeenCalledOnce();
    await expect(
      call(router.jobs.enqueue, { items: [], confirmOversize: false }),
    ).rejects.toThrow();
  });

  it("exposes typed cancel and retry controls", async () => {
    const deps = dependencies();
    const router = createServerRpcRouter(deps);
    const id = job().id;
    await expect(call(router.jobs.cancel, { id })).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(call(router.jobs.retry, { id })).resolves.toMatchObject({
      status: "queued",
    });
  });

  it("confirms an oversized job through the typed control plane", async () => {
    const deps = dependencies();
    const router = createServerRpcRouter(deps);
    const id = job().id;

    await expect(call(router.jobs.confirm, { id })).resolves.toMatchObject({
      status: "queued",
      requiresConfirmation: false,
    });
    expect(deps.confirmJob).toHaveBeenCalledWith(id);
  });

  it("validates file selection before invoking the torrent control", async () => {
    const deps = dependencies();
    const router = createServerRpcRouter(deps);
    const id = job().id;
    for (const fileIds of [[], ["0", "0"]]) {
      await expect(call(router.jobs.selectFiles, { id, fileIds })).rejects.toThrow();
    }
    expect(deps.selectFiles).not.toHaveBeenCalled();
    await expect(call(router.jobs.selectFiles, { id, fileIds: ["0"] })).resolves.toMatchObject({
      status: "queued",
    });
    expect(deps.selectFiles).toHaveBeenCalledWith(id, ["0"]);
  });

  it("exposes pause, resume, remove, reorder, and scheduler controls", async () => {
    const deps = dependencies();
    const router = createServerRpcRouter(deps);
    const id = job().id;

    await expect(call(router.jobs.pause, { id })).resolves.toMatchObject({
      status: "paused",
    });
    await expect(call(router.jobs.resume, { id })).resolves.toMatchObject({
      status: "queued",
    });
    await expect(call(router.jobs.remove, { id })).resolves.toBeUndefined();
    await expect(call(router.jobs.reorder, { jobIds: [id] })).resolves.toHaveLength(1);
    await expect(call(router.scheduler.get, undefined)).resolves.toEqual({
      activeCount: 0,
      maxConcurrent: 2,
    });
    await expect(call(router.scheduler.update, { maxConcurrent: 4 })).resolves.toEqual({
      activeCount: 0,
      maxConcurrent: 4,
    });
  });
});

it("validates video metadata paths and output through the contract", async () => {
  const deps = dependencies();
  const router = createServerRpcRouter(deps);
  const input = { sessionId: job().id, path: "clip.mp4" };
  await expect(call(router.video.qualities, input)).resolves.toMatchObject({
    path: "clip.mp4",
    defaultQuality: "source",
  });
  expect(deps.videoQualities).toHaveBeenCalledWith(input);
  vi.mocked(deps.videoQualities).mockClear();
  for (const path of ["../secret.mp4", "/clip.mp4", "C:/clip.mp4", ""]) {
    await expect(call(router.video.qualities, { ...input, path })).rejects.toThrow();
  }
  await expect(call(router.video.qualities, { ...input, sessionId: "invalid" })).rejects.toThrow();
  expect(deps.videoQualities).not.toHaveBeenCalled();
  vi.mocked(deps.videoQualities).mockResolvedValue({
    path: "clip.mp4",
    source: { width: -1, height: 720, durationSeconds: 30 },
    options: [],
    defaultQuality: "source",
  });
  await expect(call(router.video.qualities, input)).rejects.toThrow();
});

it("preserves missing-media errors over RPC", async () => {
  const deps = dependencies();
  vi.mocked(deps.videoQualities).mockRejectedValue(
    new ApplicationError("NOT_FOUND", "File not found.", 404),
  );
  await expect(
    call(createServerRpcRouter(deps).video.qualities, {
      sessionId: job().id,
      path: "missing.mp4",
    }),
  ).rejects.toMatchObject({
    code: "NOT_FOUND",
    status: 404,
    message: "File not found.",
  });
});

it("validates file priorities and global bandwidth limits at the RPC boundary", async () => {
  const deps = dependencies();
  const router = createServerRpcRouter(deps);
  const id = job().id;
  await call(router.jobs.setFilePriority, {
    id,
    fileId: "0",
    priority: "high",
  });
  expect(deps.setFilePriority).toHaveBeenCalledWith(id, "0", "high");
  await expect(
    call(router.jobs.setFilePriority, { id, fileId: "", priority: "low" }),
  ).rejects.toThrow();
  const limits = { downloadBytesPerSec: 262144, uploadBytesPerSec: 65536 };
  await expect(call(router.torrentLimits.update, limits)).resolves.toEqual(limits);
  expect(deps.updateTorrentLimits).toHaveBeenCalledWith(limits);
  await expect(call(router.torrentLimits.get, undefined)).resolves.toEqual({
    downloadBytesPerSec: 0,
    uploadBytesPerSec: 0,
  });
  for (const downloadBytesPerSec of [-1, 0.5, 1_073_741_825]) {
    await expect(
      call(router.torrentLimits.update, { ...limits, downloadBytesPerSec }),
    ).rejects.toThrow();
  }
  expect(deps.updateTorrentLimits).toHaveBeenCalledOnce();
});
