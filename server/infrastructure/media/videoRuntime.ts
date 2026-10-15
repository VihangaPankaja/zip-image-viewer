import type { VideoStoryboard } from "../../../shared/contracts.js";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { startRenditionJob } from "./videoRenditionJob.js";
import { publishedSegments } from "../../media/hlsManifest.js";
import {
  videoMetadataFromOutput,
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
import { runCommand, runCommandCapture } from "../process/commandRunner.js";
import { getSessionQualityOutputPath, remuxVideo } from "./videoRemux.js";
import {
  HlsWindows,
  windowAvailability,
  WINDOWED_AFTER_SECONDS,
} from "./hlsWindows.js";
import { videoDuration } from "./videoDuration.js";
import { prepareRetainedVideo } from "./prepareRetainedVideo.js";

const SEGMENT_SECONDS = 4;
const processLimiter = new ProcessLimiter(2);
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
  private readonly windows: HlsWindows;

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
    private readonly protectSession: (_sessionId: string) => () => void = () =>
      () =>
        undefined,
    private readonly enforceDerivedMediaBudget: () => Promise<void> = () =>
      Promise.resolve(),
  ) {
    this.windows = new HlsWindows(ffmpegPath, this.runVideoTask);
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
      async (signal) => {
        const { stderr } = await runCommandCapture(
          executable,
          ["-hide_banner", "-i", videoPath],
          { allowNonZeroExit: true, signal },
        );
        const extension = path.extname(videoPath).slice(1).toLowerCase();
        const result = videoMetadataFromOutput(stderr, extension);
        if (result.durationSeconds > WINDOWED_AFTER_SECONDS)
          result.durationSeconds = await videoDuration(
            executable,
            videoPath,
            result.durationSeconds,
            signal,
          );
        return result;
      },
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
    if (existing) return existing;
    const metadata = await this.getVideoMetadata(targetPath, session, priority);
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
    if (session.retained && entry.durationSeconds > WINDOWED_AFTER_SECONDS) {
      const prepare = prepareRetainedVideo(
        entry,
        session,
        this.windows,
        this.sessionWork(session).controller.signal,
      ).then(this.enforceDerivedMediaBudget);
      void this.trackVideoTask(session, prepare).catch((error: unknown) => {
        if (!this.sessionWork(session).controller.signal.aborted)
          this.logEvent("warn", "video.prepare.failed", {
            sessionId: session.id,
            error: error instanceof Error ? error.message : String(error),
          });
      });
    }
    return entry;
  };

  getRenditionState = getRenditionState;

  refreshRenditionAvailability = async (
    rendition: VideoRendition,
  ): Promise<number> => {
    if (rendition.durationSeconds > WINDOWED_AFTER_SECONDS) {
      return windowAvailability(rendition);
    }
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
  ): Promise<void> =>
    startRenditionJob(entry, session, rendition, {
      ffmpegPath: this.ffmpegPath,
      segmentSeconds: SEGMENT_SECONDS,
      runVideoTask: this.runVideoTask,
      refreshRenditionAvailability: this.refreshRenditionAvailability,
      enforceDerivedMediaBudget: this.enforceDerivedMediaBudget,
      logEvent: this.logEvent,
    });
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
    this.windows.ensure(entry, session, rendition, index, signal);

  getSessionQualityOutputPath = getSessionQualityOutputPath;
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
