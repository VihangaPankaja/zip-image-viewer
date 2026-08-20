import { call } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import type { Job } from "../../shared/contracts.js";
import {
  createServerRpcRouter,
  type ServerRpcDependencies,
} from "./serverRouter.js";

function job(id = "2bf886fc-65bf-4e2f-b973-b607766b3131"): Job {
  return {
    id,
    url: "https://example.com/archive.zip",
    status: "queued",
    phase: "queued",
    percent: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function dependencies(): ServerRpcDependencies {
  return {
    listJobs: () => [job()],
    listSessions: () => [],
    createJob: vi.fn(() => job()),
    enqueueJobs: vi.fn((input: { urls: string[] }) =>
      input.urls.map(() => job()),
    ),
    getSession: () => undefined,
    cancelJob: vi.fn((): Job => ({
      ...job(),
      status: "cancelled",
      phase: "cancelled",
    })),
    retryJob: vi.fn(() => job("f86946a1-bcf7-4137-87c6-51502024367a")),
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
      urls: ["https://example.com/one.zip", "https://example.com/two.zip"],
      confirmOversize: false,
    });
    expect(result.items).toHaveLength(2);
    expect(deps.enqueueJobs).toHaveBeenCalledOnce();
    await expect(
      call(router.jobs.enqueue, { urls: [], confirmOversize: false }),
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
});
