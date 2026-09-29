import type { VideoStoryboard } from "../../../shared/contracts.js";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { buildFmp4HlsArgs } from "../../media/ffmpegHls.js";
import { publishedSegments } from "../../media/hlsManifest.js";
import {
  durationFromOutput,
  dimensionsFromOutput,
  qualityOptions,
} from "../../media/videoMetadata.js";
import {
  generateStoryboard,
  storyboardDirectory,
} from "../../media/videoStoryboard.js";
import { ProcessLimiter } from "../../media/processLimiter.js";
import { getRenditionState } from "../../media/videoRendition.js";
import { errorFromUnknown } from "../runtime/mediaClassification.js";
import { runCommand, runCommandCapture } from "../process/commandRunner.js";

const SEGMENT_SECONDS = 4;
const processLimiter = new ProcessLimiter(2);
type VideoMetadata = { width: number; height: number; durationSeconds: number };
type SessionWork = {
  controller: AbortController;
  pending: Set<Promise<unknown>>;
  metadata: Map<string, Promise<VideoMetadata>>;
  storyboards: Map<string, Promise<VideoStoryboard>>;
};
type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;

class VideoRuntime {
  readonly segmentSeconds = SEGMENT_SECONDS;
  private readonly sessions = new WeakMap<Session, SessionWork>();

  private sessionWork(session: Session): SessionWork {
    let work = this.sessions.get(session);
    if (!work) {
      work = {
        controller: new AbortController(),
        pending: new Set(),
        metadata: new Map(),
        storyboards: new Map(),
      };
      this.sessions.set(session, work);
    }
    return work;
  }

  trackVideoTask = <Result>(
    session: Session | undefined,
    task: Promise<Result>,
  ): Promise<Result> => {
    if (!session) return task;
    const work = this.sessionWork(session);
    const release = this.protectSession(session.id);
    work.pending.add(task);
    void task
      .finally(() => {
        work.pending.delete(task);
        release();
      })
      .catch(() => undefined);
    return task;
  };

  runVideoTask = <Result>(
    session: Session | undefined,
    task: (_signal?: AbortSignal) => Promise<Result>,
    requestSignal?: AbortSignal,
    priority: "interactive" | "background" = "interactive",
  ): Promise<Result> => {
    const sessionSignal =
      session && this.sessionWork(session).controller.signal;
    const signal =
      sessionSignal && requestSignal
        ? AbortSignal.any([sessionSignal, requestSignal])
        : (sessionSignal ?? requestSignal);
    const start = () => {
      this.logEvent("info", "video.process.started", {
        sessionId: session?.id,
      });
      return task(signal);
    };
    return this.trackVideoTask(
      session,
      processLimiter.run(start, signal, priority),
    );
  };

  runCommand = (
    command: string,
    args: string[],
    session?: Session,
  ): Promise<void> =>
    this.runVideoTask(session, (signal) =>
      runCommand(command, args, { signal }),
    );

  cleanupVideoSession = async (session: Session): Promise<void> => {
    const work = this.sessionWork(session);
    work.controller.abort();
    await Promise.allSettled([...work.pending]);
    work.metadata.clear();
    work.storyboards.clear();
  };

  ensureVideoStoryboard = (
    session: Session,
    normalizedPath: string,
    targetPath: string,
  ): Promise<VideoStoryboard> => {
    const work = this.sessionWork(session);
    const existing = work.storyboards.get(normalizedPath);
    if (existing) return existing;
    const generation = this.trackVideoTask(
      session,
      (async () => {
        work.controller.signal.throwIfAborted();
        const metadata = await this.getVideoMetadata(targetPath, session);
        const executable = this.ffmpegPath;
        if (!executable) throw new Error("Video transcoder is unavailable.");
        const index = await generateStoryboard(
          storyboardDirectory(session.workspaceDir, normalizedPath),
          targetPath,
          metadata.durationSeconds,
          (args) => this.runCommand(executable, args, session),
        );
        await this.enforceDerivedMediaBudget();
        return index;
      })(),
    );
    work.storyboards.set(normalizedPath, generation);
    void generation
      .finally(() => work.storyboards.delete(normalizedPath))
      .catch(() => undefined);
    return generation;
  };

  constructor(
    private readonly ffmpegPath: string | null,
    private readonly transcodes: Map<string, VideoTranscodeEntry>,
    private readonly logEvent: LogEvent,
    private readonly protectSession: (_sessionId: string) => () => void = () =>
      () =>
        undefined,
    private readonly enforceDerivedMediaBudget: () => Promise<void> = () =>
      Promise.resolve(),
  ) {}

  getVideoTranscodeKey = (sessionId: string, normalizedPath: string): string =>
    `${sessionId}:${normalizedPath}`;

  getVideoMetadata = (
    videoPath: string,
    session?: Session,
  ): Promise<VideoMetadata> => {
    const executable = this.ffmpegPath;
    if (!executable)
      return Promise.resolve({ width: 0, height: 0, durationSeconds: 0 });
    const cached = session && this.sessionWork(session).metadata;
    const existing = cached && cached.get(videoPath);
    if (existing) return existing;
    const metadata = this.runVideoTask(session, async (signal) => {
      const { stderr } = await runCommandCapture(
        executable,
        ["-hide_banner", "-i", videoPath],
        { allowNonZeroExit: true, signal },
      );
      return {
        ...dimensionsFromOutput(stderr),
        durationSeconds: durationFromOutput(stderr),
      };
    });
    cached?.set(videoPath, metadata);
    void metadata.catch(() => cached?.delete(videoPath));
    return metadata;
  };

  ensureVideoTranscodeEntry = async (
    session: Session,
    normalizedPath: string,
    targetPath: string,
  ): Promise<VideoTranscodeEntry> => {
    const key = this.getVideoTranscodeKey(session.id, normalizedPath);
    const existing = this.transcodes.get(key);
    if (existing) return existing;
    const metadata = await this.getVideoMetadata(targetPath, session);
    const racedEntry = this.transcodes.get(key);
    if (racedEntry) return racedEntry;
    const qualities = qualityOptions(metadata);
    const entry: VideoTranscodeEntry = {
      sessionId: session.id,
      path: normalizedPath,
      targetPath,
      ...metadata,
      expectedSegments: Math.max(
        1,
        Math.ceil(metadata.durationSeconds / SEGMENT_SECONDS),
      ),
      qualities: qualities.options,
      defaultQuality: qualities.defaultQuality,
      renditions: new Map(),
    };
    this.transcodes.set(key, entry);
    return entry;
  };

  getRenditionState = getRenditionState;

  refreshRenditionAvailability = async (
    rendition: VideoRendition,
  ): Promise<number> => {
    const playlist = await readFile(rendition.playlistPath, "utf8").catch(
      () => "",
    );
    rendition.availableSegments = publishedSegments(playlist).length;
    return rendition.availableSegments;
  };

  startRenditionTranscode = (
    entry: VideoTranscodeEntry,
    session: Session,
    rendition: VideoRendition,
  ): Promise<void> => {
    const executable = this.ffmpegPath;
    if (!executable || rendition.status !== "idle") return Promise.resolve();
    rendition.status = "queued";
    const queuedAt = Date.now();
    rendition.queuedAt = queuedAt;
    let startedAt = queuedAt;
    this.logEvent("info", "video.transcode.queued", {
      sessionId: session.id,
      path: entry.path,
      quality: rendition.qualityId,
      cache: "miss",
    });
    const encode = async (signal?: AbortSignal) => {
      await mkdir(rendition.dir, { recursive: true });
      startedAt = Date.now();
      rendition.status = "running";
      rendition.encoderWaitMs = startedAt - queuedAt;
      this.logEvent("info", "video.transcode.started", {
        sessionId: session.id,
        path: entry.path,
        quality: rendition.qualityId,
        cache: "miss",
        queueMs: startedAt - queuedAt,
      });
      await runCommand(
        executable,
        buildFmp4HlsArgs({
          inputPath: entry.targetPath,
          outputDirectory: rendition.dir,
          height: rendition.selectedHeight,
          segmentDurationSeconds: SEGMENT_SECONDS,
        }),
        { signal },
      );
    };
    void this.runVideoTask(session, encode, undefined, "background")
      .then(async () => {
        await this.refreshRenditionAvailability(rendition);
        rendition.status = "done";
        void this.enforceDerivedMediaBudget().catch((error: unknown) =>
          this.logEvent("warn", "media.cache.cleanup.failed", {
            error: errorFromUnknown(error).message,
          }),
        );
        this.logEvent("info", "video.transcode.completed", {
          sessionId: session.id,
          path: entry.path,
          quality: rendition.qualityId,
          cache: "miss",
          queueMs: startedAt - queuedAt,
          encodeMs: Date.now() - startedAt,
        });
      })
      .catch((error: unknown) => {
        rendition.status = "error";
        this.logEvent("warn", "video.transcode.failed", {
          sessionId: session.id,
          path: entry.path,
          quality: rendition.qualityId,
          error: errorFromUnknown(error).message,
        });
      });
    return Promise.resolve();
  };

  waitForFile = async (
    filePath: string,
    timeoutMs = 12_000,
  ): Promise<boolean> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (
        await access(filePath)
          .then(() => true)
          .catch(() => false)
      )
        return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 160));
    }
    return false;
  };

  getVideoDimensions = async (videoPath: string, session?: Session) => {
    const { width, height } = await this.getVideoMetadata(videoPath, session);
    return { width, height };
  };

  buildVideoQualityOptions = (sourceHeight: number) =>
    qualityOptions({
      width: sourceHeight,
      height: sourceHeight,
      durationSeconds: 0,
    });

  startPrioritySegmentWindow = async (
    entry: VideoTranscodeEntry,
    session: Session,
    rendition: VideoRendition,
  ) => this.startRenditionTranscode(entry, session, rendition);

  getSessionQualityOutputPath = (
    session: Session,
    normalizedPath: string,
    quality: string,
  ) =>
    path.join(
      session.workspaceDir,
      "video-quality",
      quality,
      `${crypto.createHash("sha1").update(normalizedPath).digest("hex")}.mp4`,
    );
}

export function createVideoRuntime({
  ffmpegPath,
  transcodes,
  logEvent,
  protectSession,
  enforceDerivedMediaBudget,
}: {
  ffmpegPath: string | null;
  transcodes: Map<string, VideoTranscodeEntry>;
  logEvent: LogEvent;
  protectSession?: (_sessionId: string) => () => void;
  enforceDerivedMediaBudget?: () => Promise<void>;
}) {
  return new VideoRuntime(
    ffmpegPath,
    transcodes,
    logEvent,
    protectSession,
    enforceDerivedMediaBudget,
  );
}
