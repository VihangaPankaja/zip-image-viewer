import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { buildTree, type ExtractedEntry } from "../../domain/explorerTree.js";
import type { Session, SessionJob } from "../../domain/models.js";
import {
  VIDEO_EXTENSIONS,
  errorFromUnknown,
} from "../../infrastructure/runtime/mediaClassification.js";
import {
  normalizeDownloadSettings,
  downloadOptionsToSettings,
} from "../downloads/downloadOptions.js";
import { downloadSessionSource, type DownloadSourceDependencies } from "./downloadSessionSource.js";
import { extractSessionSource } from "./extractSessionSource.js";
import { ArchiveSelectionRequired, prepareZipArchive } from "./archiveSelection.js";
import { stageExtraction } from "../../infrastructure/archive/stagedExtraction.js";
import { downloadTorrentSource } from "../torrents/downloadTorrentSource.js";
import type { TorrentAdapter } from "../torrents/torrentDownloader.js";
import { prepareTorrentEntries } from "../torrents/prepareTorrentEntries.js";
import { refreshArchiveSession } from "../sessions/refreshArchiveSession.js";
import {
  assertHttpWorkspace,
  httpSourcePath,
} from "../../infrastructure/downloads/httpWorkspace.js";

type ProcessorDependencies = DownloadSourceDependencies & {
  prepareRetainedSession?: (_session: Session) => void;
  torrentAdapter: TorrentAdapter;
  sessionStore: Map<string, Session>;
  detectEncryption: (_archivePath: string, _signal?: AbortSignal) => Promise<boolean>;
  extractWith7zip: (
    _archivePath: string,
    _extractDir: string,
    _signal?: AbortSignal,
  ) => Promise<void>;
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

function configureJob(job: SessionJob): ReturnType<typeof normalizeDownloadSettings> {
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

export function createSession(
  workspaceDir: string,
  extractDir: string,
  sourceName: string,
  entries: Awaited<ReturnType<typeof extractSessionSource>>,
): Session {
  const archiveName = path.basename(sourceName) || "download";
  const rootName = archiveName.replace(/\.(zip|rar|7z|tar|gz|tgz)$/i, "") || archiveName;
  const { tree, firstFilePath, stats } = buildTree(entries, rootName);
  const videoCount = entries.filter(
    ({ type, relativePath }) =>
      type === "file" && VIDEO_EXTENSIONS.has(path.extname(relativePath).slice(1).toLowerCase()),
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

function torrentDisplayName(source: string): string {
  if (!source.startsWith("magnet:")) return new URL(source).pathname;
  return new URL(source).searchParams.get("dn") || "torrent";
}

function completeSession(
  job: SessionJob,
  session: Session,
  message: string,
  deps: ProcessorDependencies,
): void {
  job.abortController?.signal.throwIfAborted();
  if (job.zipSelection && job.archive) {
    job.zipSelection.extractedIds = [...job.zipSelection.selectedIds];
    job.archive.extractedCount = job.zipSelection.extractedIds.length;
  }
  session.jobId = job.id;
  session.archiveProcessingMs = job.archiveProcessingMs ?? 0;
  deps.sessionStore.set(session.id, session);
  if (job.sourceKind === "http" && !job.storageRoot && !job.archive)
    Object.assign(job, { workspaceDir: "", extractDir: "", zipPath: "" });
  session.retained = job.sourceKind === "torrent" || !!job.storageRoot;
  deps.emitJob(
    job,
    {
      status: "ready",
      phase: "ready",
      sessionId: session.id,
      percent: 100,
      message,
      requiresConfirmation: false,
      canPause: false,
    },
    "ready",
  );
  job.abortController?.signal.throwIfAborted();
  deps.closeJob(job, "ready");
  job.abortController?.signal.throwIfAborted();
  deps.logEvent("info", "session.create.complete", {
    jobId: job.id,
    sessionId: session.id,
    fileCount: session.stats.fileCount,
  });
}

function emitFailure(job: SessionJob, error: Error, deps: ProcessorDependencies): void {
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

async function processTorrentJob(
  job: SessionJob,
  confirmOversize: boolean,
  settings: ReturnType<typeof normalizeDownloadSettings>,
  deps: ProcessorDependencies,
): Promise<void> {
  const torrentDir = path.join(job.workspaceDir, "torrent");
  await mkdir(torrentDir, { recursive: true });
  const result = await downloadTorrentSource(
    job,
    settings,
    { downloadDir: torrentDir, confirmOversize },
    { adapter: deps.torrentAdapter, emitJob: deps.emitJob },
  );
  if (result === "paused") {
    deps.closeJob(job, job.status);
    return;
  }
  const session = await restoreTorrentSession(job, deps);
  completeSession(job, session, "Torrent is ready to browse.", deps);
}

export async function restoreTorrentSession(
  job: SessionJob,
  deps: ProcessorDependencies,
): Promise<Session> {
  return refreshArchiveSession(deps.sessionStore.get(job.sessionId), job, async (admit) => {
    const prepared = await prepareTorrentEntries(
      job,
      path.join(job.workspaceDir, "torrent"),
      job.extractDir,
      { ...deps, admitArchiveEntries: admit },
    );
    const session = createSession(
      job.workspaceDir,
      prepared.sessionDir,
      torrentDisplayName(job.url),
      prepared.entries,
    );
    session.id = job.sessionId || session.id;
    session.jobId = job.id;
    session.archiveProcessingMs = job.archiveProcessingMs ?? 0;
    session.availablePaths = new Set(
      prepared.entries.filter((entry) => entry.type === "file").map((entry) => entry.relativePath),
    );
    session.retained = true;
    const existing = deps.sessionStore.get(session.id);
    // Keep the session object that owns active viewers and cancellable media work.
    const retainedSession = existing ? Object.assign(existing, session) : session;
    deps.sessionStore.set(session.id, retainedSession);
    deps.prepareRetainedSession?.(retainedSession);
    return retainedSession;
  });
}

async function processHttpJob(
  job: SessionJob,
  confirmOversize: boolean,
  settings: ReturnType<typeof normalizeDownloadSettings>,
  deps: ProcessorDependencies,
): Promise<void> {
  const { workspaceDir, zipPath } = job;
  const result = await downloadSessionSource(
    job,
    settings,
    { url: job.url, zipPath, workspaceDir, confirmOversize },
    deps,
  );
  if (result === "paused") return;
  job.abortController?.signal.throwIfAborted();
  const existing = deps.sessionStore.get(job.sessionId);
  await refreshArchiveSession(existing, job, (admit) =>
    publishHttpSource(job, deps, existing, admit),
  );
}

async function publishHttpSource(
  job: SessionJob,
  deps: ProcessorDependencies,
  existing: Session | undefined,
  admit: (_entries: ExtractedEntry[]) => void,
) {
  const { workspaceDir, extractDir, zipPath } = job;
  if (!(await prepareZipArchive(job, zipPath, deps.emitJob))) return;
  let entries: ExtractedEntry[];
  if (job.archive || existing) {
    entries = await stageExtraction(extractDir, async (staging) => {
      const extracted = await extractSessionSource(job, zipPath, staging, deps);
      job.abortController?.signal.throwIfAborted();
      admit(extracted);
      return extracted;
    });
  } else {
    // Extraction can be interrupted at any entry. Rebuild derived files from the verified source.
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    entries = await extractSessionSource(job, zipPath, extractDir, deps);
  }
  const sourceName = new URL(job.url).pathname || "download";
  const session = createSession(workspaceDir, extractDir, sourceName, entries);
  session.id = job.sessionId || session.id;
  completeSession(
    job,
    existing
      ? Object.assign(existing, {
          tree: session.tree,
          firstFilePath: session.firstFilePath,
          stats: session.stats,
        })
      : session,
    job.archive ? "Selected ZIP files are ready to browse." : "Archive is ready to browse.",
    deps,
  );
}

async function processSessionJob(
  deps: ProcessorDependencies,
  job: SessionJob,
  confirmOversize: boolean,
): Promise<void> {
  const sourceUrl = job.sourceKind === "http" ? parseSourceUrl(job.url) : null;
  const workspaceDir =
    job.workspaceDir || (await mkdtemp(path.join(os.tmpdir(), "zip-image-viewer-")));
  const zipPath =
    job.zipPath ||
    (sourceUrl
      ? job.storageRoot
        ? httpSourcePath({ ...job, workspaceDir })
        : path.join(workspaceDir, path.basename(sourceUrl.pathname) || "download.bin")
      : "");
  const extractDir = job.extractDir || path.join(workspaceDir, "extracted");
  await assertHttpWorkspace({ ...job, workspaceDir });
  await mkdir(job.archive ? workspaceDir : extractDir, { recursive: true });
  Object.assign(job, {
    workspaceDir,
    zipPath,
    extractDir,
    abortController: new AbortController(),
    pauseRequested: false,
  });
  const settings = configureJob(job);
  try {
    if (sourceUrl) {
      await processHttpJob(job, confirmOversize, settings, deps);
    } else {
      await processTorrentJob(job, confirmOversize, settings, deps);
    }
  } catch (error) {
    if (error instanceof ArchiveSelectionRequired) return;
    const abortReason: unknown = job.abortController?.signal.reason;
    const jobError =
      job.status === "error" && job.error
        ? new Error(job.error)
        : errorFromUnknown(abortReason instanceof Error ? abortReason : error);
    if (jobError.name === "AbortError" && job.pauseRequested && job.canResume) {
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
    if (
      job.sourceKind === "http" &&
      !job.storageRoot &&
      !job.archive &&
      !deps.sessionStore.has(job.sessionId)
    )
      await rm(workspaceDir, { recursive: true, force: true });
    if (jobError.name !== "AbortError") {
      deps.logEvent("error", "session.create.failed", {
        jobId: job.id,
        error: jobError.message,
      });
    }
    emitFailure(job, jobError, deps);
  }
}

export function createProcessSessionJob(deps: ProcessorDependencies) {
  return (job: SessionJob, confirmOversize = false) =>
    processSessionJob(deps, job, confirmOversize);
}
