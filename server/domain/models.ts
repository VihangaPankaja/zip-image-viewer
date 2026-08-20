import type { Response } from "express";
import type { WebSocket } from "ws";
import type { ChildProcess } from "node:child_process";

export type JobStatus =
  | "queued"
  | "downloading"
  | "extracting"
  | "awaiting_confirmation"
  | "ready"
  | "cancelled"
  | "error";

export type JobPhase =
  | "queued"
  | "downloading"
  | "extracting"
  | "confirm"
  | "ready"
  | "cancelled"
  | "error";

export type ExplorerNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  parentPath?: string;
  extension?: string;
  size?: number;
  modifiedAt: number;
  children?: ExplorerNode[];
};

export type Session = {
  id: string;
  workspaceDir: string;
  extractDir: string;
  tree: ExplorerNode;
  firstFilePath: string;
  stats: { fileCount: number };
  selectedVideoQuality: string;
  transcodeStatus: {
    quality: string;
    done: boolean;
    completed: number;
    total: number;
  };
  lastAccessedAt: number;
};

export type ThreadMode = "single" | "segmented" | "auto";
export type DownloadOptions = {
  transport: {
    mode: ThreadMode;
    threads: number;
    multithread: boolean;
    resume: boolean;
  };
  retry: { maxRetries: number; timeoutMs: number };
  media: { videoQuality: string };
  extraction: { enabled: boolean };
  request: { headers: Record<string, string> };
};

export type SessionJob = {
  id: string;
  url: string;
  status: JobStatus;
  phase: JobPhase;
  percent: number | null;
  downloadedBytes: number;
  reportedSize: number;
  extractedEntries: number;
  totalEntries: number;
  downloadSpeedBytesPerSec: number;
  averageSpeedBytesPerSec: number;
  etaSeconds: number | null;
  isStalled: boolean;
  stallDurationMs: number;
  retryCount: number;
  maxRetries: number;
  canResume: boolean;
  threadMode: ThreadMode;
  threadCount: number;
  enableMultithread: boolean;
  enableResume: boolean;
  message: string;
  error: string;
  transcodedEntries: number;
  totalTranscodeEntries: number;
  videoQuality: string;
  createdAt: number;
  updatedAt: number;
  zipPath: string;
  workspaceDir: string;
  sessionId: string;
  requiresConfirmation: boolean;
  cleanupAt: number;
  abortController: AbortController | null;
  extractDir: string;
  downloadOptions: DownloadOptions;
  subscribers: Set<Response>;
  socketSubscribers: Set<WebSocket>;
};

export type VideoQualityOption = {
  id: string;
  label: string;
  height: number | null;
};

export type VideoRendition = {
  qualityId: string;
  selectedHeight: number;
  dir: string;
  playlistPath: string;
  status: "idle" | "running" | "done" | "error";
  process: ChildProcess | null;
  availableSegments: number;
  expectedSegments: number;
  durationSeconds: number;
  priorityJobs: Map<number, Promise<void>>;
};

export type VideoTranscodeEntry = {
  sessionId: string;
  targetPath: string;
  path: string;
  width: number;
  height: number;
  durationSeconds: number;
  expectedSegments: number;
  qualities: VideoQualityOption[];
  defaultQuality: string;
  renditions: Map<string, VideoRendition>;
};

export type TypedErrorCode =
  | "INVALID_INPUT"
  | "INVALID_JSON"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class ApplicationError extends Error {
  readonly code: TypedErrorCode;
  readonly status: number;

  constructor(
    _code: TypedErrorCode,
    message: string,
    _status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApplicationError";
    this.code = _code;
    this.status = _status;
  }
}
