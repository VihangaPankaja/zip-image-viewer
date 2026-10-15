import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { expect, it, vi } from "vitest";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { createVideoRuntime } from "./videoRuntime.js";
import {
  buildWindowPlaylist,
  windowDirectory,
  HlsWindows,
} from "./hlsWindows.js";
import { runCommand, runCommandCapture } from "../process/commandRunner.js";
import { startMultilingualFixture } from "../../../tests/fixtures/multilingual.js";

it("promotes queued preparation without rejecting its background consumer", async () => {
  const priorities: string[] = [];
  const run: ConstructorParameters<typeof HlsWindows>[1] = (
    _session,
    _task,
    signal,
    priority,
  ) => {
    priorities.push(priority ?? "interactive");
    if (priority === "interactive") return Promise.resolve();
    return new Promise<void>((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("Requeued")), {
        once: true,
      }),
    );
  };
  const windows = new HlsWindows("ffmpeg", run);
  const entry = { expectedSegments: 900 } as VideoTranscodeEntry;
  const rendition = {
    dir: path.join(tmpdir(), "unpublished-promote-window"),
    priorityJobs: new Map(),
  } as VideoRendition;
  const background = windows.ensure(
    entry,
    {} as Session,
    rendition,
    0,
    undefined,
    "background",
  );
  await vi.waitFor(() => expect(priorities).toEqual(["background"]));
  const foreground = windows.ensure(entry, {} as Session, rendition, 1);
  await Promise.all([background, foreground]);
  expect(priorities).toEqual(["background", "interactive"]);
});

it.each([20, 128])(
  "prepares retained low video and default audio through the final window at %s seconds",
  async (duration) => {
    const fixture = await startMultilingualFixture(
      "http://127.0.0.1:5173",
      0,
      duration,
    );
    try {
      fixture.session.retained = true;
      const entry = await fixture.runtime.ensureVideoTranscodeEntry(
        fixture.session,
        "multilingual.mkv",
        path.join(fixture.directory, "multilingual.mkv"),
      );
      expect(entry.renditions.has("360p")).toBe(true);
      await vi.waitFor(
        () => {
          for (const id of ["360p", "audio-1"]) {
            const rendition = entry.renditions.get(id);
            expect(rendition?.status).toBe("done");
            expect(rendition?.availableSegments).toBeGreaterThan(0);
            if (duration > 120)
              expect(rendition?.availableSegments).toBe(entry.expectedSegments);
          }
        },
        { timeout: 90_000 },
      );
      if (duration > 120)
        expect(entry.renditions.get("audio-2")).toBeUndefined();
    } finally {
      await fixture.close();
    }
  },
  120_000,
);

it.each([128, 130.25])(
  "uses the real video end and decodes the final window at %s seconds",
  async (duration) => {
    if (!ffmpegPath) throw new Error("FFmpeg is required.");
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "seek-tail-"));
    const session = { id: "tail", workspaceDir } as Session;
    const runtime = createVideoRuntime({
      ffmpegPath,
      transcodes: new Map(),
      logEvent: () => undefined,
    });
    try {
      const source = path.join(workspaceDir, "tail.mkv");
      await runCommand(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=size=32x32:rate=24:duration=${duration}`,
        "-f",
        "lavfi",
        "-i",
        `sine=duration=${duration}`,
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        source,
      ]);
      const entry = await runtime.ensureVideoTranscodeEntry(
        session,
        "tail.mkv",
        source,
      );
      expect(entry.durationSeconds).toBeCloseTo(duration, 2);
      expect(entry.expectedSegments).toBe(Math.ceil(duration / 4));
      const rendition = runtime.getRenditionState(entry, session, "source");
      await runtime.startPrioritySegmentWindow(
        entry,
        session,
        rendition,
        entry.expectedSegments - 1,
      );
      const decoded = await runCommandCapture(ffmpegPath, [
        "-hide_banner",
        "-i",
        path.join(
          windowDirectory(rendition, entry.expectedSegments - 1),
          "index.m3u8",
        ),
        "-f",
        "null",
        "-",
      ]);
      expect(decoded.stderr).not.toMatch(/frame=\s*0\s|Invalid data|after EOF/);
    } finally {
      await runtime.cleanupVideoSession(session);
      await rm(workspaceDir, { recursive: true, force: true });
    }
  },
  45_000,
);

it("publishes alternate audio on the same long-video window boundaries", async () => {
  const fixture = await startMultilingualFixture(
    "http://127.0.0.1:5173",
    0,
    160,
  );
  try {
    const entry = await fixture.runtime.ensureVideoTranscodeEntry(
      fixture.session,
      "multilingual.mkv",
      path.join(fixture.directory, "multilingual.mkv"),
    );
    const audio = fixture.runtime.getRenditionState(
      entry,
      fixture.session,
      "audio-1",
    );
    await fixture.runtime.startPrioritySegmentWindow(
      entry,
      fixture.session,
      audio,
      32,
    );
    expect(
      await readFile(
        path.join(windowDirectory(audio, 32), "index.m3u8"),
        "utf8",
      ),
    ).toContain("segment_000032.m4s");
  } finally {
    await fixture.close();
  }
}, 45_000);

it("advertises the complete timeline, window maps and exact fractional final duration", () => {
  const playlist = buildWindowPlaylist(
    3600.25,
    (i) => `init-${i}`,
    (i) => `segment-${i}`,
  );
  expect(playlist.match(/#EXTINF:/g)).toHaveLength(901);
  expect(playlist).toContain('#EXT-X-MAP:URI="init-720"');
  expect(playlist).toContain("#EXTINF:0.250000,\nsegment-900");
  expect(playlist.match(/#EXT-X-DISCONTINUITY/g)).toHaveLength(450);
  expect(playlist).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
  expect(playlist).toMatch(/#EXT-X-ENDLIST\n$/);
});

it("decodes audio/video at 80% of a cold hour without encoding earlier windows", async () => {
  if (!ffmpegPath) throw new Error("FFmpeg is required.");
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "seek-window-"));
  const session = { id: "cold-hour", workspaceDir } as Session;
  const runtime = createVideoRuntime({
    ffmpegPath,
    transcodes: new Map(),
    logEvent: () => undefined,
  });
  try {
    const seed = path.join(workspaceDir, "seed.mp4");
    const source = path.join(workspaceDir, "hour.mp4");
    await runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=10:duration=16",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=16",
      "-c:v",
      "mpeg4",
      "-g",
      "100",
      "-c:a",
      "aac",
      seed,
    ]);
    await runCommand(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-stream_loop",
      "-1",
      "-i",
      seed,
      "-t",
      "3600",
      "-c",
      "copy",
      source,
    ]);
    const entry = await runtime.ensureVideoTranscodeEntry(
      session,
      "hour.mp4",
      source,
    );
    expect(entry.durationSeconds).toBeCloseTo(3600, 0);
    const rendition = runtime.getRenditionState(entry, session, "source");
    await runtime.startPrioritySegmentWindow(entry, session, rendition, 720);
    const directory = windowDirectory(rendition, 720);
    expect(
      (await readdir(rendition.dir)).filter((name) =>
        name.startsWith("window-"),
      ),
    ).toEqual(["window-720"]);
    const playlist = await readFile(path.join(directory, "index.m3u8"), "utf8");
    expect(playlist).toContain("segment_000720.m4s");
    const decoded = await runCommandCapture(ffmpegPath, [
      "-hide_banner",
      "-i",
      path.join(directory, "index.m3u8"),
      "-f",
      "null",
      "-",
    ]);
    expect(decoded.stderr).toContain("Audio:");
    expect(decoded.stderr).toMatch(/frame=\s*240/);
    expect(decoded.stderr).not.toMatch(/Invalid data|corrupt|Non-monotonic/i);
    const before = (await readdir(directory)).sort();
    await runtime.startPrioritySegmentWindow(entry, session, rendition, 721);
    expect((await readdir(directory)).sort()).toEqual(before);
    await expect(
      runtime.startPrioritySegmentWindow(entry, session, rendition, 99999),
    ).rejects.toThrow("outside");
  } finally {
    await runtime.cleanupVideoSession(session);
    await rm(workspaceDir, { recursive: true, force: true });
  }
}, 60_000);

it("cancels only after all consumers abandon a shared window", async () => {
  let release!: () => void;
  let workSignal: AbortSignal | undefined;
  let starts = 0;
  const run = (
    _session: Session,
    _task: unknown,
    signal?: AbortSignal,
  ): Promise<never> => {
    starts += 1;
    workSignal = signal;
    return new Promise<never>((resolve, reject) => {
      release = () => resolve(undefined as never);
      signal?.addEventListener("abort", () => reject(new Error("Cancelled")), {
        once: true,
      });
    });
  };
  const windows = new HlsWindows("ffmpeg", run);
  const entry = { expectedSegments: 900 } as VideoTranscodeEntry;
  const rendition = {
    priorityJobs: new Map(),
    dir: path.join(tmpdir(), "unpublished-window-test"),
  } as VideoRendition;
  const first = new AbortController();
  const second = new AbortController();
  const a = windows.ensure(entry, {} as Session, rendition, 720, first.signal);
  const b = windows.ensure(entry, {} as Session, rendition, 721, second.signal);
  await vi.waitFor(() => expect(starts).toBe(1));
  first.abort();
  await expect(a).rejects.toThrow();
  expect(workSignal?.aborted).toBe(false);
  expect(starts).toBe(1);
  release();
  await b;
  const third = new AbortController();
  const c = windows.ensure(entry, {} as Session, rendition, 724, third.signal);
  await vi.waitFor(() => expect(starts).toBe(2));
  third.abort();
  await expect(c).rejects.toThrow();
  expect(workSignal?.aborted).toBe(true);
});
