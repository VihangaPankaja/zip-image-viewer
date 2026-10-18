import type { VideoStoryboard } from "../../../shared/contracts.js";
import { access } from "node:fs/promises";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { startRenditionJob } from "./videoRenditionJob.js";
import {
  qualityOptions,
  buildVideoQualityOptions,
  type VideoMetadata,
} from "../../media/videoMetadata.js";
import {
  generateStoryboard,
  storyboardDirectory,
} from "../../media/videoStoryboard.js";
import { ProcessLimiter } from "../../media/processLimiter.js";
import { getRenditionState } from "../../media/videoRendition.js";
import { runCommand } from "../process/commandRunner.js";
import { getSessionQualityOutputPath, remuxVideo } from "./videoRemux.js";
import { HlsWindows, refreshRenditionAvailability } from "./hlsWindows.js";
import { probeVideoMetadata } from "./videoDuration.js";
import { HlsPlaybackPreparation } from "./hlsPlaybackPreparation.js";
import { RetainedVideoPreparation } from "./prepareRetainedVideo.js";
import { HlsEncoder } from "./hlsEncoder.js";
import type { HlsEncoderPreference } from "../../config/runtimeConstants.js";

const SEGMENT_SECONDS = 4;
const processLimiter = new ProcessLimiter(2);
type WaitForEviction = (_sessionId: string) => Promise<void>;
type ProtectSession = (_id: string, _allowEviction?: boolean) => () => void;
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
  private readonly preparation: RetainedVideoPreparation;
  private readonly playback: HlsPlaybackPreparation;
  private readonly encoder: HlsEncoder;

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
    protectCache = true,
  ): Promise<Result> => {
    if (!session) return task;
    const work = this.sessionWork(session);
    const release = this.protectSession(session.id, !protectCache);
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
    const start = async () => {
      if (session) await this.waitForEviction(session.id);
      signal?.throwIfAborted();
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
    this.clearCachedMedia(session);
  };

  clearCachedMedia = (session: Session): void => {
    this.sessionWork(session).storyboards.clear();
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
    private readonly protectSession: ProtectSession = () => () => undefined,
    private readonly enforceDerivedMediaBudget: () => Promise<void> = () =>
      Promise.resolve(),
    private readonly waitForEviction: WaitForEviction = () => Promise.resolve(),
    encoderPreference: HlsEncoderPreference = "cpu",
  ) {
    this.encoder = new HlsEncoder(
      ffmpegPath ?? "",
      encoderPreference,
      logEvent,
    );
    const windows = new HlsWindows(ffmpegPath, this.runVideoTask, this.encoder);
    const preparationDependencies = {
      signalFor: (session: Session) =>
        this.sessionWork(session).controller.signal,
      track: (session: Session, task: Promise<void>) =>
        this.trackVideoTask(session, task, false),
      enforceBudget: this.enforceDerivedMediaBudget,
      onError: (session: Session, error: unknown) =>
        this.logEvent("warn", "video.prepare.failed", {
          sessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        }),
    };
    this.playback = new HlsPlaybackPreparation(
      windows,
      preparationDependencies,
    );
    this.preparation = new RetainedVideoPreparation({
      ...preparationDependencies,
      windows,
      startSequential: (entry, session, rendition) =>
        this.startRenditionTranscode(entry, session, rendition, "background"),
    });
  }

  getVideoTranscodeKey = (sessionId: string, normalizedPath: string): string =>
    `${sessionId}:${normalizedPath}`;

  prepareVideoRemux = (
    session: Session,
    normalizedPath: string,
    targetPath: string,
  ): Promise<string> =>
    remuxVideo(
      session,
      normalizedPath,
      targetPath,
      this.ffmpegPath,
      (task) => this.runVideoTask(session, task),
      this.enforceDerivedMediaBudget,
    );

  getVideoMetadata = (
    videoPath: string,
    session?: Session,
    priority: "interactive" | "background" = "interactive",
  ): Promise<VideoMetadata> => {
    const executable = this.ffmpegPath;
    if (!executable)
      return Promise.resolve({ width: 0, height: 0, durationSeconds: 0 });
    const cached = session && this.sessionWork(session).metadata;
    const existing = cached && cached.get(videoPath);
    if (existing) return existing;
    const metadata = this.runVideoTask(
      session,
      (signal) => probeVideoMetadata(executable, videoPath, signal),
      undefined,
      priority,
    );
    cached?.set(videoPath, metadata);
    void metadata.catch(() => cached?.delete(videoPath));
    return metadata;
  };

  ensureVideoTranscodeEntry = async (
    session: Session,
    normalizedPath: string,
    targetPath: string,
    priority: "interactive" | "background" = "interactive",
  ): Promise<VideoTranscodeEntry> => {
    const key = this.getVideoTranscodeKey(session.id, normalizedPath);
    const existing = this.transcodes.get(key);
    if (existing) return this.preparation.ensure(existing, session, priority);
    const metadata = await this.getVideoMetadata(targetPath, session, priority);
    const racedEntry = this.transcodes.get(key);
    if (racedEntry)
      return this.preparation.ensure(racedEntry, session, priority);
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
    return this.preparation.ensure(entry, session, priority);
  };

  getRenditionState = getRenditionState;

  refreshRenditionAvailability = refreshRenditionAvailability;

  startRenditionTranscode = (
    entry: VideoTranscodeEntry,
    session: Session,
    rendition: VideoRendition,
    priority?: "interactive" | "background",
  ): Promise<void> =>
    startRenditionJob(
      entry,
      session,
      rendition,
      {
        ffmpegPath: this.ffmpegPath,
        segmentSeconds: SEGMENT_SECONDS,
        encoder: this.encoder,
        runVideoTask: this.runVideoTask,
        refreshRenditionAvailability: this.refreshRenditionAvailability,
        enforceDerivedMediaBudget: this.enforceDerivedMediaBudget,
        logEvent: this.logEvent,
      },
      priority,
    );
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

  buildVideoQualityOptions = buildVideoQualityOptions;

  startPrioritySegmentWindow = (
    entry: VideoTranscodeEntry,
    session: Session,
    rendition: VideoRendition,
    index: number,
    signal?: AbortSignal,
  ): Promise<void> =>
    this.playback.ensure(entry, session, rendition, index, signal);

  getSessionQualityOutputPath = getSessionQualityOutputPath;
}

export function createVideoRuntime({
  ffmpegPath,
  transcodes,
  logEvent,
  protectSession,
  enforceDerivedMediaBudget,
  waitForEviction,
  encoderPreference,
}: {
  ffmpegPath: string | null;
  transcodes: Map<string, VideoTranscodeEntry>;
  logEvent: LogEvent;
  protectSession?: ProtectSession;
  enforceDerivedMediaBudget?: () => Promise<void>;
  waitForEviction?: WaitForEviction;
  encoderPreference?: HlsEncoderPreference;
}) {
  return new VideoRuntime(
    ffmpegPath,
    transcodes,
    logEvent,
    protectSession,
    enforceDerivedMediaBudget,
    waitForEviction,
    encoderPreference,
  );
}
