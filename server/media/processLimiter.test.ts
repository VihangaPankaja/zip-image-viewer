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

  it("reserves preview capacity and gives a waiting encode the next opening", async () => {
    const limiter = new ProcessLimiter(2);
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const run = (name: string, priority: "interactive" | "background") =>
      limiter.run(
        () => {
          started.push(name);
          return new Promise<void>((resolve) => releases.set(name, resolve));
        },
        undefined,
        priority,
      );

    const firstEncode = run("encode 1", "background");
    const secondEncode = run("encode 2", "background");
    const firstPreview = run("preview 1", "interactive");
    const secondPreview = run("preview 2", "interactive");
    await vi.waitFor(() => expect(started).toEqual(["encode 1", "preview 1"]));

    releases.get("encode 1")?.();
    await firstEncode;
    await vi.waitFor(() =>
      expect(started).toEqual(["encode 1", "preview 1", "encode 2"]),
    );
    releases.get("preview 1")?.();
    await firstPreview;
    await vi.waitFor(() => expect(started).toContain("preview 2"));
    releases.get("encode 2")?.();
    releases.get("preview 2")?.();
    await Promise.all([secondEncode, secondPreview]);
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

it("does not start a task cancelled just after an immediate permit grant", async () => {
  const limiter = new ProcessLimiter(1);
  const controller = new AbortController();
  const task = vi.fn(() => Promise.resolve());
  const pending = limiter.run(task, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(task).not.toHaveBeenCalled();
  await expect(limiter.run(() => Promise.resolve("available"))).resolves.toBe(
    "available",
  );
});
