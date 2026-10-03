import { afterEach, expect, it, vi } from "vitest";
import type { Session } from "../../domain/models.js";
import { createVideoRuntime } from "./videoRuntime.js";

const commands = vi.hoisted(() => ({
  active: 0,
  peak: 0,
  releases: [] as (() => void)[],
  started: [] as string[],
}));
vi.mock("../process/commandRunner.js", () => {
  const run = (
    command: string,
    args: string[],
    { signal }: { signal?: AbortSignal } = {},
  ) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      commands.active += 1;
      commands.peak = Math.max(commands.peak, commands.active);
      commands.started.push(args.includes("-i") ? "metadata" : command);
      const finish = () => {
        commands.active -= 1;
        signal?.removeEventListener("abort", cancel);
        resolve({
          stdout: "",
          stderr: "Duration: 00:00:08.00\nVideo: h264, 640x360",
        });
      };
      const cancel = () => {
        commands.active -= 1;
        reject(new DOMException("Cancelled", "AbortError"));
      };
      commands.releases.push(finish);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  return { runCommand: run, runCommandCapture: run };
});
afterEach(() => {
  commands.active = 0;
  commands.peak = 0;
  commands.releases = [];
  commands.started = [];
});

it("shares two permits across runtime instances, coalesces probes and cancels queued/running session work", async () => {
  const runtime = createVideoRuntime({
    ffmpegPath: "ffmpeg",
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  const other = createVideoRuntime({
    ffmpegPath: "ffmpeg",
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  const firstSession = { id: "first" } as Session;
  const secondSession = { id: "second" } as Session;
  const first = runtime.runCommand("thumbnail", [], firstSession);
  const second = other.runCommand("hls", [], secondSession);
  const metadata = runtime.getVideoMetadata("clip", firstSession);
  const sharedMetadata = runtime.getVideoMetadata("clip", firstSession);
  expect(sharedMetadata).toBe(metadata);
  await vi.waitFor(() => expect(commands.active).toBe(2));
  expect(commands.started).toEqual(["thumbnail", "hls"]);
  commands.releases.shift()?.();
  await first;
  await vi.waitFor(() => expect(commands.started).toContain("metadata"));
  commands.releases.pop()?.();
  await expect(metadata).resolves.toEqual({
    width: 640,
    height: 360,
    durationSeconds: 8,
    playbackMode: "transcode",
  });
  await runtime.getVideoMetadata("clip", firstSession);
  expect(commands.started.filter((name) => name === "metadata")).toHaveLength(
    1,
  );
  const running = runtime.runCommand("storyboard", [], firstSession);
  const queued = runtime.runCommand("queued thumbnail", [], firstSession);
  const failures = Promise.allSettled([running, queued]);
  await vi.waitFor(() => expect(commands.started).toContain("storyboard"));
  await runtime.cleanupVideoSession(firstSession);
  expect((await failures).every((result) => result.status === "rejected")).toBe(
    true,
  );
  expect(commands.started).not.toContain("queued thumbnail");
  expect(commands.peak).toBe(2);
  const secondResult = Promise.allSettled([second]);
  await other.cleanupVideoSession(secondSession);
  await secondResult;
  expect(commands.active).toBe(0);
});

it("cancels a disconnected request while both media slots are occupied", async () => {
  const runtime = createVideoRuntime({
    ffmpegPath: "ffmpeg",
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  const session = { id: "request" } as Session;
  const occupied = Promise.allSettled([
    runtime.runCommand("first", [], session),
    runtime.runCommand("second", [], session),
  ]);
  await vi.waitFor(() => expect(commands.active).toBe(2));
  const controller = new AbortController();
  const task = vi.fn(() => Promise.resolve());
  const queued = runtime.runVideoTask(session, task, controller.signal);
  controller.abort();
  await expect(queued).rejects.toMatchObject({ name: "AbortError" });
  expect(task).not.toHaveBeenCalled();
  await runtime.cleanupVideoSession(session);
  await occupied;
  expect(commands.active).toBe(0);
});

it("drains rapid queued seeks before a session workspace can be removed", async () => {
  const runtime = createVideoRuntime({
    ffmpegPath: "ffmpeg",
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  const session = { id: "rapid-seeks" } as Session;
  const requests = Array.from({ length: 40 }, () =>
    runtime.runCommand("seek", [], session),
  );
  const settled = Promise.allSettled(requests);
  await vi.waitFor(() => expect(commands.active).toBe(2));
  await runtime.cleanupVideoSession(session);
  expect((await settled).every(({ status }) => status === "rejected")).toBe(
    true,
  );
  expect(commands.active).toBe(0);
  expect(commands.started).toHaveLength(2);
});
