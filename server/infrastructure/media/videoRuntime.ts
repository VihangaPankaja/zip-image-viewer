import { access, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type {
  Session,
  VideoQualityOption,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";
import { buildFmp4HlsArgs } from "../../media/ffmpegHls.js";
import { calculateRenditions } from "../../media/hlsManifest.js";
import { ProcessLimiter } from "../../media/processLimiter.js";
import { errorFromUnknown } from "../runtime/mediaClassification.js";
import { runCommand, runCommandCapture } from "../process/commandRunner.js";

const SEGMENT_SECONDS = 4;
const processLimiter = new ProcessLimiter(2);
type VideoMetadata = { width: number; height: number; durationSeconds: number };
type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;

function durationFromOutput(output: string): number {
  const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return 0;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseFloat(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

function dimensionsFromOutput(output: string): {
  width: number;
  height: number;
} {
  const videoLine = output
    .split(/\r?\n/)
    .find((line) => line.includes("Video:"));
  const match = videoLine?.match(/\b(\d{2,5})x(\d{2,5})\b/);
  return {
    width: Number.parseInt(match?.[1] ?? "0", 10),
    height: Number.parseInt(match?.[2] ?? "0", 10),
  };
}

function qualityOptions(metadata: VideoMetadata): {
  options: VideoQualityOption[];
  defaultQuality: string;
} {
  const options: VideoQualityOption[] = [
    { id: "source", label: "Original", height: metadata.height },
    ...calculateRenditions(metadata)
      .filter(({ id }) => id !== "source")
      .map(({ id, height }) => ({ id, label: id, height })),
  ];
  return {
    options,
    defaultQuality: options.some(({ id }) => id === "720p")
      ? "720p"
      : (options.at(-1)?.id ?? "source"),
  };
}

class VideoRuntime {
  readonly segmentSeconds = SEGMENT_SECONDS;
  readonly runCommand = runCommand;

  constructor(
    private readonly ffmpegPath: string | null,
    private readonly transcodes: Map<string, VideoTranscodeEntry>,
    private readonly logEvent: LogEvent,
  ) {}

  getVideoTranscodeKey = (sessionId: string, normalizedPath: string): string =>
    `${sessionId}:${normalizedPath}`;

  getVideoMetadata = async (videoPath: string): Promise<VideoMetadata> => {
    if (!this.ffmpegPath) return { width: 0, height: 0, durationSeconds: 0 };
    const { stderr } = await runCommandCapture(
      this.ffmpegPath,
      ["-hide_banner", "-i", videoPath],
      { allowNonZeroExit: true },
    ).catch(() => ({ stdout: "", stderr: "" }));
    return {
      ...dimensionsFromOutput(stderr),
      durationSeconds: durationFromOutput(stderr),
    };
  };

  ensureVideoTranscodeEntry = async (
    session: Session,
    normalizedPath: string,
    targetPath: string,
  ): Promise<VideoTranscodeEntry> => {
    const key = this.getVideoTranscodeKey(session.id, normalizedPath);
    const existing = this.transcodes.get(key);
    if (existing) return existing;
    const metadata = await this.getVideoMetadata(targetPath);
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

  getRenditionState = (
    entry: VideoTranscodeEntry,
    session: Session,
    qualityId: string,
  ): VideoRendition => {
    const existing = entry.renditions.get(qualityId);
    if (existing) return existing;
    const height =
      qualityId === "source"
        ? 0
        : Number.parseInt(qualityId.replace("p", ""), 10) || 0;
    const hash = crypto
      .createHash("sha1")
      .update(`${session.id}:${entry.path}:${qualityId}`)
      .digest("hex");
    const rendition: VideoRendition = {
      qualityId,
      selectedHeight: height,
      dir: path.join(session.workspaceDir, "video-transcodes", hash),
      playlistPath: "",
      status: "idle",
      process: null,
      priorityJobs: new Map(),
      availableSegments: 0,
      expectedSegments: entry.expectedSegments,
      durationSeconds: entry.durationSeconds,
    };
    entry.renditions.set(qualityId, rendition);
    return rendition;
  };

  refreshRenditionAvailability = async (
    rendition: VideoRendition,
  ): Promise<number> => {
    const entries = await readdir(rendition.dir).catch(() => []);
    rendition.availableSegments = entries.filter((entry) =>
      /^segment_\d+\.m4s$/i.test(entry),
    ).length;
    return rendition.availableSegments;
  };

  startRenditionTranscode = async (
    entry: VideoTranscodeEntry,
    session: Session,
    rendition: VideoRendition,
  ): Promise<void> => {
    const executable = this.ffmpegPath;
    if (!executable || rendition.status !== "idle") return;
    await mkdir(rendition.dir, { recursive: true });
    rendition.status = "running";
    void processLimiter
      .run(() =>
        runCommand(
          executable,
          buildFmp4HlsArgs({
            inputPath: entry.targetPath,
            outputDirectory: rendition.dir,
            height: rendition.selectedHeight,
            segmentDurationSeconds: SEGMENT_SECONDS,
          }),
        ),
      )
      .then(async () => {
        await this.refreshRenditionAvailability(rendition);
        rendition.status = "done";
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

  getVideoDimensions = async (videoPath: string) => {
    const { width, height } = await this.getVideoMetadata(videoPath);
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
}: {
  ffmpegPath: string | null;
  transcodes: Map<string, VideoTranscodeEntry>;
  logEvent: LogEvent;
}) {
  return new VideoRuntime(ffmpegPath, transcodes, logEvent);
}
