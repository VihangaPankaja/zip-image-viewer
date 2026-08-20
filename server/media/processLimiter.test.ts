import { describe, expect, it, vi } from "vitest";
import { ProcessLimiter } from "./processLimiter.js";

describe("ProcessLimiter", () => {
  it.each([0, -1, 1.5])("rejects invalid concurrency %s", (limit) => {
    expect(() => new ProcessLimiter(limit)).toThrow(RangeError);
  });

  it("runs at most two FFmpeg tasks concurrently", async () => {
    const limiter = new ProcessLimiter(2);
    let active = 0;
    let peak = 0;
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;

    const task = (setRelease: (_release: () => void) => void) =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => {
          setRelease(resolve);
        });
        active -= 1;
      });

    const first = task((release) => {
      releaseFirst = release;
    });
    const second = task((release) => {
      releaseSecond = release;
    });
    const third = limiter.run(() => {
      active += 1;
      peak = Math.max(peak, active);
      active -= 1;
      return Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(active).toBe(2);
    });
    releaseFirst?.();
    releaseSecond?.();
    await Promise.all([first, second, third]);

    expect(peak).toBe(2);
  });

  it("rejects a queued task when its signal is cancelled", async () => {
    const limiter = new ProcessLimiter(1);
    let release: (() => void) | undefined;
    const running = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const queued = limiter.run(() => Promise.resolve(), controller.signal);

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    release?.();
    await running;
  });

  it("rejects a task whose signal is already cancelled", async () => {
    const limiter = new ProcessLimiter(1);
    const controller = new AbortController();
    controller.abort();
    await expect(
      limiter.run(() => Promise.resolve(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("removes a queued task's abort listener when it starts", async () => {
    const limiter = new ProcessLimiter(1);
    let release: (() => void) | undefined;
    const running = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const queued = limiter.run(
      () => Promise.resolve("started"),
      controller.signal,
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release?.();
    await expect(queued).resolves.toBe("started");
    await running;
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
