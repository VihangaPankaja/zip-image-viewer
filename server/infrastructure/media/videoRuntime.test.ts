import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session, VideoTranscodeEntry } from "../../domain/models.js";
import { createVideoRuntime } from "./videoRuntime.js";

const commands = vi.hoisted(() => ({
  active: 0,
  peak: 0,
  releases: [] as (() => void)[],
  started: [] as string[],
  args: [] as string[][],
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
      commands.args.push(args);
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
  commands.args = [];
});

it("starts all audio streams together beside a running background video encoder", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "video-audio-group-"));
  const runtime = createVideoRuntime({
    ffmpegPath: "ffmpeg",
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  const session = { id: "audio-group", workspaceDir: directory } as Session;
  const entry = {
    path: "clip.mkv",
    targetPath: "clip.mkv",
    renditions: new Map(),
    audioTracks: [
      {
        id: "audio-1",
        index: 1,
        language: "eng",
        label: "English",
        isDefault: true,
      },
      {
        id: "audio-2",
        index: 2,
        language: "spa",
        label: "Spanish",
        isDefault: false,
      },
    ],
  } as unknown as VideoTranscodeEntry;
  const video = runtime.getRenditionState(entry, session, "360p");
  const first = runtime.getRenditionState(entry, session, "audio-1");
  const second = runtime.getRenditionState(entry, session, "audio-2");
  try {
    await runtime.startRenditionTranscode(entry, session, video);
    await vi.waitFor(() => expect(commands.active).toBe(1));
    await runtime.startRenditionTranscode(entry, session, first);
    await runtime.startRenditionTranscode(entry, session, second);
    await vi.waitFor(() => expect(commands.active).toBe(2));
    expect([video.status, first.status, second.status]).toEqual([
      "running",
      "running",
      "running",
    ]);
    expect(commands.args[1]).toContain("0:1");
    expect(commands.args[1]).toContain("0:2");
    expect(commands.started).toHaveLength(2);
    commands.releases[1]?.();
    await vi.waitFor(() =>
      expect([first.status, second.status]).toEqual(["done", "done"]),
    );
    expect(video.status).toBe("running");
    await runtime.startRenditionTranscode(entry, session, second);
    expect(commands.started).toHaveLength(2);
    first.status = "idle";
    await runtime.startRenditionTranscode(entry, session, first);
    await vi.waitFor(() => expect(commands.started).toHaveLength(3));
    expect(commands.args[2]).toContain("0:1");
    expect(commands.args[2]).not.toContain("0:2");
  } finally {
    await runtime.cleanupVideoSession(session);
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects unprobed audio IDs before queuing an encoder", async () => {
  const runtime = createVideoRuntime({
    ffmpegPath: "ffmpeg",
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  const session = { id: "invalid-audio", workspaceDir: "workspace" } as Session;
  const entry = {
    path: "clip.mkv",
    renditions: new Map(),
    audioTracks: [],
  } as unknown as VideoTranscodeEntry;
  const rendition = runtime.getRenditionState(entry, session, "audio-99");
  await expect(
    runtime.startRenditionTranscode(entry, session, rendition),
  ).rejects.toThrow("Unknown audio track");
  expect(rendition.status).toBe("idle");
  expect(commands.started).toHaveLength(0);
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
    audioTracks: [],
    subtitleTracks: [],
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
