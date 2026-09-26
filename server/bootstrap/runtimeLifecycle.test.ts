import type { Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import type { Session, SessionJob } from "../domain/models.js";
import {
  CLEANUP_INTERVAL_MS,
  SESSION_TTL_MS,
} from "../config/runtimeConstants.js";
import { registerRuntimeLifecycle } from "./runtimeLifecycle.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(SESSION_TTL_MS * 2);
  const signals = new Map<string | symbol, () => void>();
  vi.spyOn(process, "on").mockImplementation((event, handler) => {
    signals.set(event, handler as () => void);
    return process;
  });
  const exit = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
  const deps = {
    sessions: new Map<string, Session>(),
    jobs: new Map<string, SessionJob>(),
    getServer: vi.fn<() => Server | undefined>(),
    removeSession: vi
      .fn<(id: string, reason: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    cleanupJob: vi
      .fn<(id: string, reason: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    shutdownServices: [
      vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ],
    logEvent: vi.fn(),
  };
  registerRuntimeLifecycle(deps);
  return { deps, signals, exit };
}

it("expires only stale sessions and jobs past their cleanup deadline", async () => {
  const { deps } = setup();
  deps.sessions.set("stale", { lastAccessedAt: 0 } as Session);
  deps.sessions.set("recent", { lastAccessedAt: Date.now() } as Session);
  deps.jobs.set("expired", { cleanupAt: 1 } as SessionJob);
  deps.jobs.set("active", { cleanupAt: 0 } as SessionJob);
  deps.jobs.set("future", {
    cleanupAt: Date.now() + CLEANUP_INTERVAL_MS * 2,
  } as SessionJob);
  await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
  expect(deps.removeSession.mock.calls).toEqual([["stale", "expired"]]);
  expect(deps.cleanupJob.mock.calls).toEqual([["expired", "expired"]]);
});

it("records cleanup failures without stopping later cleanup", async () => {
  const { deps } = setup();
  deps.sessions.set("stale", { lastAccessedAt: 0 } as Session);
  deps.jobs.set("expired", { cleanupAt: 1 } as SessionJob);
  deps.removeSession.mockRejectedValue(new Error("Filesystem busy"));
  deps.cleanupJob.mockRejectedValue("unknown failure");
  await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS * 2);
  expect(deps.removeSession).toHaveBeenCalledTimes(2);
  expect(deps.cleanupJob).toHaveBeenCalledTimes(2);
  expect(deps.logEvent).toHaveBeenCalledWith(
    "error",
    "session.cleanup.failed",
    expect.objectContaining({ id: "stale", error: "Filesystem busy" }),
  );
  expect(deps.logEvent).toHaveBeenCalledWith(
    "error",
    "job.cleanup.failed",
    expect.objectContaining({ error: "Unexpected cleanup failure" }),
  );
});

it("shuts down sessions, jobs and services once even when both signals arrive", async () => {
  const { deps, signals, exit } = setup();
  deps.sessions.set("session", {} as Session);
  deps.jobs.set("job", {} as SessionJob);
  signals.get("SIGTERM")?.();
  signals.get("SIGINT")?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.removeSession.mock.calls).toEqual([["session", "shutdown"]]);
  expect(deps.cleanupJob.mock.calls).toEqual([["job", "shutdown"]]);
  expect(deps.shutdownServices[0]).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledWith(0);
});

it("reports server-close failure and exits unsuccessfully", async () => {
  const { deps, signals, exit } = setup();
  deps.getServer.mockReturnValue({
    close: (callback: (error: Error) => void) =>
      callback(new Error("Close failed")),
  } as Server);
  signals.get("SIGINT")?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(deps.logEvent).toHaveBeenCalledWith(
    "error",
    "shutdown.failed",
    expect.objectContaining({ error: "Close failed" }),
  );
  expect(exit).toHaveBeenCalledWith(1);
});
