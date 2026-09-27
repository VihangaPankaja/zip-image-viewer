import type { VideoStoryboard } from "../../../shared/contracts.js";
import type {
  Session,
  VideoQualityOption,
  VideoRendition,
  VideoTranscodeEntry,
} from "../../domain/models.js";

type ByteRange = { start: number; end: number };
type VideoMetadata = { width: number; height: number; durationSeconds: number };

export type VideoRouteDependencies = {
  ensureVideoStoryboard: (
    _session: Session,
    _path: string,
    _targetPath: string,
  ) => Promise<VideoStoryboard>;
  trackVideoTask: <Result>(
    _session: Session | undefined,
    _task: Promise<Result>,
  ) => Promise<Result>;
  runVideoTask: <Result>(
    _session: Session | undefined,
    _task: (_signal?: AbortSignal) => Promise<Result>,
    _signal?: AbortSignal,
  ) => Promise<Result>;
  touchSession: (_sessionId: string) => Session | undefined;
  sanitizeEntryPath: (_path: string) => string;
  getSessionQualityOutputPath: (
    _session: Session,
    _path: string,
    _quality: string,
  ) => string;
  parseRangeHeader: (
    _header: string | undefined,
    _size: number,
  ) => ByteRange | "invalid" | null;
  VIDEO_EXTENSIONS: ReadonlySet<string>;
  getVideoMetadata: (
    _path: string,
    _session?: Session,
  ) => Promise<VideoMetadata>;
  buildVideoQualityOptions: (_height: number) => {
    options: VideoQualityOption[];
    defaultQuality: string;
  };
  parseSeekSeconds: (_value: unknown) => number;
  ffmpegPath: string | null;
  ensureVideoTranscodeEntry: (
    _session: Session,
    _path: string,
    _targetPath: string,
  ) => Promise<VideoTranscodeEntry>;
  getRenditionState: (
    _entry: VideoTranscodeEntry,
    _session: Session,
    _quality: string,
  ) => VideoRendition;
  startRenditionTranscode: (
    _entry: VideoTranscodeEntry,
    _session: Session,
    _rendition: VideoRendition,
  ) => Promise<void>;
  startPrioritySegmentWindow: (
    _entry: VideoTranscodeEntry,
    _session: Session,
    _rendition: VideoRendition,
    _index: number,
  ) => Promise<void>;
  refreshRenditionAvailability: (_rendition: VideoRendition) => Promise<number>;
  DEFAULT_VIDEO_SEGMENT_SECONDS: number;
  runCommand: (
    _command: string,
    _args: string[],
    _session?: Session,
  ) => Promise<void>;
  waitForFile: (_path: string, _timeoutMs: number) => Promise<boolean>;
  getVideoTranscodeKey: (_sessionId: string, _path: string) => string;
  videoTranscodeStore: ReadonlyMap<string, VideoTranscodeEntry>;
  getVideoDimensions: (
    _path: string,
    _session?: Session,
  ) => Promise<{ height: number }>;
  logEvent: (
    _level: "info" | "warn" | "error",
    _event: string,
    _details?: Record<string, unknown>,
  ) => void;
};
