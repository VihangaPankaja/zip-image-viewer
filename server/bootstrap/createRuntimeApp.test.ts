import path from "node:path";
import { once } from "node:events";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { describe, expect, it, vi } from "vitest";
import { serverContract } from "../../shared/contracts.js";
import type { Session, SessionJob } from "../domain/models.js";
import { createJobManager } from "../application/jobs/jobManager.js";
import { createRuntimeApp } from "./createRuntimeApp.js";

describe("createRuntimeApp", () => {
  it("requeues a confirmed oversized job with its size guard explicitly accepted", async () => {
    const jobs = new Map<string, SessionJob>();
    const sessions = new Map<string, Session>();
    const manager = createJobManager(jobs, vi.fn());
    const job = manager.createJob("https://example.com/large.zip");
    Object.assign(job, {
      status: "awaiting_confirmation",
      phase: "confirm",
      requiresConfirmation: true,
      cleanupAt: Date.now() + 60_000,
    });
    const confirmJob = vi.fn(() => {
      Object.assign(job, {
        status: "queued",
        phase: "queued",
        requiresConfirmation: false,
        cleanupAt: 0,
        message: "Confirmation accepted. Waiting to start.",
      });
      return job;
    });
    const app = createRuntimeApp({
      metrics: { getSessionCount: () => 0, getJobCount: () => jobs.size },
      distDir: path.resolve("dist"),
      jobs,
      sessions,
      sanitizeJob: manager.sanitizeJob,
      createJob: manager.createJob,
      enqueueJob: vi.fn(),
      confirmJob,
      listOrderedJobs: () => [job],
      pauseJob: vi.fn(),
      resumeJob: vi.fn(),
      cancelJob: vi.fn(),
      retryJob: vi.fn(),
      removeJob: vi.fn(),
      reorderJobs: vi.fn(),
      getSchedulerSettings: () => ({ activeCount: 0, maxConcurrent: 2 }),
      updateSchedulerSettings: vi.fn(),
      removeSession: vi.fn(),
    });

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Runtime test server did not bind to a TCP port.");
    }
    try {
      const rpc = createORPCClient<ContractRouterClient<typeof serverContract>>(
        new RPCLink({
          url: `http://127.0.0.1:${String(address.port)}/rpc`,
        }),
      );
      await expect(rpc.jobs.confirm({ id: job.id })).resolves.toMatchObject({
        id: job.id,
        status: "queued",
        phase: "queued",
        requiresConfirmation: false,
      });
      expect(confirmJob).toHaveBeenCalledWith(job.id);
      expect(job.cleanupAt).toBe(0);
      expect(job.message).toBe("Confirmation accepted. Waiting to start.");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
