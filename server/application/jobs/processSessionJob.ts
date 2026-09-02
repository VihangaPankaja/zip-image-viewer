import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { buildTree } from "../../domain/explorerTree.js";
import type { Session, SessionJob } from "../../domain/models.js";
import {
  VIDEO_EXTENSIONS,
  errorFromUnknown,
} from "../../infrastructure/runtime/mediaClassification.js";
import {
  normalizeDownloadSettings,
  downloadOptionsToSettings,
} from "../downloads/downloadOptions.js";
import {
  downloadSessionSource,
  type DownloadSourceDependencies,
} from "./downloadSessionSource.js";
import { extractSessionSource } from "./extractSessionSource.js";

type ProcessorDependencies = DownloadSourceDependencies & {
  sessionStore: Map<string, Session>;
  detectEncryption: (_archivePath: string) => Promise<boolean>;
  extractWith7zip: (_archivePath: string, _extractDir: string) => Promise<void>;
  listExtractedEntries: (
    _extractDir: string,
  ) => Promise<import("../../domain/explorerTree.js").ExtractedEntry[]>;
  logEvent: (
    _level: "info" | "warn" | "error",
    _event: string,
    _details?: Record<string, unknown>,
  ) => void;
};

function parseSourceUrl(value: string): URL {
  if (!URL.canParse(value)) throw new Error("Enter a valid public URL.");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  }
  return url;
}

function configureJob(
  job: SessionJob,
): ReturnType<typeof normalizeDownloadSettings> {
  const settings = downloadOptionsToSettings(job.downloadOptions);
  Object.assign(job, {
    maxRetries: settings.maxRetries,
    threadMode: settings.threadMode,
    threadCount: settings.threadCount,
    enableMultithread: settings.enableMultithread,
    enableResume: settings.enableResume,
    videoQuality: settings.videoQuality,
  });
  return settings;
}

function createSession(
  workspaceDir: string,
  extractDir: string,
  sourceUrl: URL,
  entries: Awaited<ReturnType<typeof extractSessionSource>>,
): Session {
  const archiveName = path.basename(sourceUrl.pathname) || "download";
  const rootName =
    archiveName.replace(/\.(zip|rar|7z|tar|gz|tgz)$/i, "") || archiveName;
  const { tree, firstFilePath, stats } = buildTree(entries, rootName);
  const videoCount = entries.filter(
    ({ type, relativePath }) =>
      type === "file" &&
      VIDEO_EXTENSIONS.has(path.extname(relativePath).slice(1).toLowerCase()),
  ).length;
  return {
    id: crypto.randomUUID(),
    workspaceDir,
    extractDir,
    tree,
    firstFilePath,
    stats,
    selectedVideoQuality: "720p",
    transcodeStatus: {
      quality: "720p",
      done: true,
      completed: 0,
      total: videoCount,
    },
    lastAccessedAt: Date.now(),
  };
}

function emitFailure(
  job: SessionJob,
  error: Error,
  deps: ProcessorDependencies,
): void {
  if (error.name === "AbortError") {
    deps.emitJob(
      job,
      {
        status: "cancelled",
        phase: "cancelled",
        error: "",
        message: "Archive loading was cancelled.",
      },
      "cancelled",
    );
    deps.closeJob(job, "cancelled");
    return;
  }
  deps.emitJob(
    job,
    {
      status: "error",
      phase: "error",
      error: error.message || "Could not process this file.",
      message: error.message || "Could not process this file.",
    },
    "job-error",
  );
  deps.closeJob(job, "error");
}

export function createProcessSessionJob(deps: ProcessorDependencies) {
  return async function processSessionJob(
    job: SessionJob,
    confirmOversize = false,
  ): Promise<void> {
    const sourceUrl = parseSourceUrl(job.url);
    const workspaceDir =
      job.workspaceDir ||
      (await mkdtemp(path.join(os.tmpdir(), "zip-image-viewer-")));
    const zipPath =
      job.zipPath ||
      path.join(
        workspaceDir,
        path.basename(sourceUrl.pathname) || "download.bin",
      );
    const extractDir = job.extractDir || path.join(workspaceDir, "extracted");
    await mkdir(extractDir, { recursive: true });
    Object.assign(job, {
      workspaceDir,
      zipPath,
      extractDir,
      abortController: new AbortController(),
      pauseRequested: false,
    });
    const settings = configureJob(job);
    try {
      const downloadResult = await downloadSessionSource(
        job,
        settings,
        {
          url: job.url,
          zipPath,
          workspaceDir,
          confirmOversize,
        },
        deps,
      );
      if (downloadResult === "paused") return;
      const entries = await extractSessionSource(
        job,
        zipPath,
        extractDir,
        deps,
      );
      const session = createSession(
        workspaceDir,
        extractDir,
        sourceUrl,
        entries,
      );
      deps.sessionStore.set(session.id, session);
      Object.assign(job, { workspaceDir: "", extractDir: "", zipPath: "" });
      deps.emitJob(
        job,
        {
          status: "ready",
          phase: "ready",
          sessionId: session.id,
          percent: 100,
          message: "Archive is ready to browse.",
          requiresConfirmation: false,
          canPause: false,
        },
        "ready",
      );
      deps.closeJob(job, "ready");
      deps.logEvent("info", "session.create.complete", {
        jobId: job.id,
        sessionId: session.id,
        fileCount: session.stats.fileCount,
      });
    } catch (error) {
      const jobError = errorFromUnknown(error);
      const paused =
        jobError.name === "AbortError" && job.pauseRequested && job.canResume;
      if (paused) {
        deps.emitJob(
          job,
          {
            status: "paused",
            phase: "paused",
            canPause: false,
            pauseRequested: false,
            abortController: null,
            message: "Download paused. Partial data is preserved.",
          },
          "paused",
        );
        return;
      }
      await rm(workspaceDir, { recursive: true, force: true });
      deps.logEvent("error", "session.create.failed", {
        jobId: job.id,
        error: jobError.message,
      });
      emitFailure(job, jobError, deps);
    }
  };
}
