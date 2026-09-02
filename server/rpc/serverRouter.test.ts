import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import { jobSchema, type Job } from "../../shared/contracts.js";
import {
  createServerRpcRouter,
  type ServerRpcDependencies,
} from "./serverRouter.js";

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
    listJobs: () => [job()],
    listSessions: () => [],
    createJob: vi.fn(() => job()),
    enqueueJobs: vi.fn((input: { items: Array<{ url: string }> }) =>
      input.items.map(() => job()),
    ),
    getSession: () => undefined,
    cancelJob: vi.fn((): Job => ({
      ...job(),
      status: "cancelled",
      phase: "cancelled",
    })),
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
    removeSession: vi.fn(() => undefined),
  };
}

describe("createServerRpcRouter", () => {
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
      items: [
        { url: "https://example.com/one.zip" },
        { url: "https://example.com/two.zip" },
      ],
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
    await expect(
      call(router.jobs.reorder, { jobIds: [id] }),
    ).resolves.toHaveLength(1);
    await expect(call(router.scheduler.get, undefined)).resolves.toEqual({
      activeCount: 0,
      maxConcurrent: 2,
    });
    await expect(
      call(router.scheduler.update, { maxConcurrent: 4 }),
    ).resolves.toEqual({ activeCount: 0, maxConcurrent: 4 });
  });
});
