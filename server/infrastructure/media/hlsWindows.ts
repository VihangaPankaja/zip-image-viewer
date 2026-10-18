import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  link,
  unlink,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { type Fmp4HlsInput } from "../../media/ffmpegHls.js";
import { publishedSegments } from "../../media/hlsManifest.js";
import { HlsEncoder } from "./hlsEncoder.js";

export const WINDOW_SEGMENTS = 2;
const HLS_SEGMENT_SECONDS = 4;
export const WINDOWED_AFTER_SECONDS = 120;

function windowStart(index: number): number {
  return Math.floor(index / WINDOW_SEGMENTS) * WINDOW_SEGMENTS;
}

export function windowDirectory(
  rendition: VideoRendition,
  index: number,
): string {
  return path.join(rendition.dir, `window-${String(windowStart(index))}`);
}

async function windowAvailability(rendition: VideoRendition): Promise<number> {
  const directories = await readdir(rendition.dir).catch(() => []);
  const counts = await Promise.all(
    directories
      .filter((name) => /^window-\d+$/.test(name))
      .map(async (name) => {
        const source = await readFile(
          path.join(rendition.dir, name, "index.m3u8"),
          "utf8",
        ).catch(() => "");
        const start = Number(name.slice(7));
        return publishedSegments(source).filter(
          (index) =>
            index <
            Math.min(start + WINDOW_SEGMENTS, rendition.expectedSegments),
        ).length;
      }),
  );
  rendition.availableSegments = counts.reduce((sum, count) => sum + count, 0);
  return rendition.availableSegments;
}

export async function refreshRenditionAvailability(
  rendition: VideoRendition,
): Promise<number> {
  if (rendition.durationSeconds > WINDOWED_AFTER_SECONDS) {
    return windowAvailability(rendition);
  }
  const playlist = await readFile(rendition.playlistPath, "utf8").catch(
    () => "",
  );
  rendition.availableSegments = publishedSegments(playlist).length;
  return rendition.availableSegments;
}

export function buildWindowPlaylist(
  duration: number,
  initUri: (_index: number) => string,
  segmentUri: (_index: number) => string,
): string {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:4",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
  ];
  for (
    let index = 0;
    index < Math.ceil(duration / HLS_SEGMENT_SECONDS);
    index += 1
  ) {
    if (index % WINDOW_SEGMENTS === 0) {
      if (index) lines.push("#EXT-X-DISCONTINUITY");
      lines.push(`#EXT-X-MAP:URI="${initUri(index)}"`);
    }
    lines.push(
      `#EXTINF:${Math.min(HLS_SEGMENT_SECONDS, duration - index * HLS_SEGMENT_SECONDS).toFixed(6)},`,
      segmentUri(index),
    );
  }
  return `${lines.join("\n")}\n#EXT-X-ENDLIST\n`;
}

type Priority = "interactive" | "background";
type Job = {
  promise: Promise<void>;
  controller: AbortController;
  consumers: number;
  priority: Priority;
  started: boolean;
};
type RunTask = (
  _session: Session,
  _task: (_signal?: AbortSignal) => Promise<void>,
  _signal?: AbortSignal,
  _priority?: Priority,
) => Promise<void>;

async function consume(job: Job, signal?: AbortSignal): Promise<void> {
  job.consumers += 1;
  let onAbort: (() => void) | undefined;
  try {
    await (signal
      ? Promise.race([
          job.promise,
          new Promise<never>((_resolve, reject) => {
            onAbort = () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Seek request cancelled."),
              );
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
          }),
        ])
      : job.promise);
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    job.consumers -= 1;
    if (!job.consumers) job.controller.abort();
  }
}

async function cachedWindow(
  destination: string,
  index: number,
): Promise<boolean> {
  const playlist = await readFile(
    path.join(destination, "index.m3u8"),
    "utf8",
  ).catch(() => "");
  if (
    !playlist.includes("#EXT-X-ENDLIST") ||
    /#EXTINF:0(?:\.0+)?,/.test(playlist) ||
    !publishedSegments(playlist).includes(index)
  )
    return false;
  return Promise.all(
    ["init.mp4", `segment_${String(index).padStart(6, "0")}.m4s`].map((name) =>
      access(path.join(destination, name)),
    ),
  ).then(
    () => true,
    () => false,
  );
}

async function publishWindow(
  temporary: string,
  rendition: VideoRendition,
  entry: VideoTranscodeEntry,
  start: number,
  audio: boolean,
): Promise<void> {
  const playlist = await readFile(path.join(temporary, "index.m3u8"), "utf8");
  const expected = Math.min(WINDOW_SEGMENTS, entry.expectedSegments - start);
  const segments = publishedSegments(playlist);
  // AAC priming can leave one final padding packet beyond the window.
  const audioPadding =
    audio &&
    segments.length === expected + 1 &&
    /#EXTINF:0\.0[0-4]\d*,\r?\nsegment_\d+\.m4s\r?\n#EXT-X-ENDLIST/.test(
      playlist,
    );
  if (
    !playlist.includes("#EXT-X-ENDLIST") ||
    !Array.from({ length: expected }, (_, offset) => start + offset).every(
      (segment) => segments.includes(segment),
    ) ||
    (segments.length !== expected && !audioPadding)
  )
    throw new Error("Encoder did not publish a complete seek window.");
  const initPath = path.join(temporary, "init.mp4");
  const init = await readFile(initPath);
  const sharedInit = path.join(
    rendition.dir,
    `init-${createHash("sha256").update(init).digest("hex")}.mp4`,
  );
  await link(initPath, sharedInit).catch((error: unknown) => {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    )
      throw error;
  });
  await unlink(initPath);
  await link(sharedInit, initPath);
  await rm(windowDirectory(rendition, start), { recursive: true, force: true });
  await rename(temporary, windowDirectory(rendition, start));
  rendition.availableSegments += expected;
}

export class HlsWindows {
  private readonly jobs = new WeakMap<VideoRendition, Map<number, Job>>();
  constructor(
    private readonly executable: string | null,
    private readonly runTask: RunTask,
    private readonly encoder = new HlsEncoder(
      executable ?? "",
      "cpu",
      () => undefined,
    ),
  ) {}

  private async encode(
    entry: VideoTranscodeEntry,
    rendition: VideoRendition,
    start: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const executable = this.executable;
    if (!executable) throw new Error("Video transcoder is unavailable.");
    await mkdir(rendition.dir, { recursive: true });
    const temporary = await mkdtemp(path.join(rendition.dir, ".window-"));
    try {
      rendition.status = "running";
      const audio = entry.audioTracks?.find(
        ({ id }) => id === rendition.qualityId,
      );
      if (rendition.qualityId.startsWith("audio-") && !audio)
        throw new Error("Unknown audio track.");
      const input: Fmp4HlsInput = {
        inputPath: entry.targetPath,
        outputDirectory: temporary,
        height: rendition.selectedHeight,
        audioStreamIndex: audio?.index,
        videoOnly: !audio && (entry.audioTracks?.length ?? 0) > 1,
        window: {
          startSeconds: start * HLS_SEGMENT_SECONDS,
          durationSeconds: Math.min(
            WINDOW_SEGMENTS * HLS_SEGMENT_SECONDS,
            entry.durationSeconds - start * HLS_SEGMENT_SECONDS,
          ),
          startIndex: start,
        },
      };
      await this.encoder.encode(input, signal);
      signal?.throwIfAborted();
      await publishWindow(temporary, rendition, entry, start, Boolean(audio));
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private createJob(
    entry: VideoTranscodeEntry,
    session: Session,
    rendition: VideoRendition,
    index: number,
    priority: Priority,
  ): Job {
    const start = windowStart(index);
    const queuedAt = Date.now();
    const job: Job = {
      promise: Promise.resolve(),
      controller: new AbortController(),
      consumers: 0,
      priority,
      started: false,
    };
    job.promise = Promise.resolve().then(async () => {
      if (await cachedWindow(windowDirectory(rendition, start), index)) {
        if (!rendition.availableSegments) await windowAvailability(rendition);
        return;
      }
      for (;;) {
        const controller = job.controller;
        try {
          await this.runTask(
            session,
            (taskSignal) => {
              job.started = true;
              rendition.encoderWaitMs = Date.now() - queuedAt;
              return this.encode(entry, rendition, start, taskSignal);
            },
            controller.signal,
            job.priority,
          );
          return;
        } catch (error) {
          // Promotion requeues the same shared promise on the interactive lane.
          if (controller === job.controller) throw error;
        }
      }
    });
    return job;
  }

  async ensure(
    entry: VideoTranscodeEntry,
    session: Session,
    rendition: VideoRendition,
    index: number,
    signal?: AbortSignal,
    priority: Priority = "interactive",
  ): Promise<void> {
    signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= entry.expectedSegments
    )
      throw new RangeError("Segment index is outside the video.");
    const start = windowStart(index);
    let jobs = this.jobs.get(rendition);
    if (!jobs) {
      jobs = new Map();
      this.jobs.set(rendition, jobs);
    }
    let job = jobs.get(start);
    // A cancelled encoder must exit before a replacement may publish this window.
    if (job?.controller.signal.aborted) {
      await job.promise.catch(() => undefined);
      return this.ensure(entry, session, rendition, index, signal, priority);
    }
    if (!job) {
      job = this.createJob(entry, session, rendition, index, priority);
      jobs.set(start, job);
      rendition.priorityJobs.set(start, job.promise);
      rendition.status = "queued";
      void job.promise
        .finally(() => {
          jobs.delete(start);
          rendition.priorityJobs.delete(start);
          if (!rendition.priorityJobs.size)
            rendition.status =
              rendition.availableSegments >= entry.expectedSegments
                ? "done"
                : "idle";
        })
        .catch(() => undefined);
    } else if (
      priority === "interactive" &&
      job.priority === "background" &&
      !job.started
    ) {
      job.priority = "interactive";
      job.controller.abort();
      job.controller = new AbortController();
    }
    await consume(job, signal);
  }
}
