import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import type { SessionJob } from "../../domain/models.js";
import type { RetainedTorrentStore } from "../../repositories/retainedTorrents.js";
import { saveRetainedTorrent } from "../../repositories/retainedTorrents.js";
import { normalizeDownloadOptions } from "./downloadOptions.js";
import {
  hashDownloadFile,
  reconcileHttpFiles,
} from "../../infrastructure/downloads/httpCheckpoint.js";
import {
  assertHttpWorkspace,
  httpSourcePath,
} from "../../infrastructure/downloads/httpWorkspace.js";

export async function restoreHttpDownloads(
  store: RetainedTorrentStore,
  jobs: Map<string, SessionJob>,
  processJob: (_job: SessionJob, _confirmed: boolean) => Promise<void>,
) {
  for (const snapshot of store.readHttp()) {
    const job = hydrateHttpJob(snapshot, store.directory);
    jobs.set(job.id, job);
    try {
      await assertHttpWorkspace(job);
      const source = await lstat(job.zipPath).catch(() => null);
      const complete =
        source?.isFile() &&
        job.httpDownload?.completedSha256 &&
        (await hashDownloadFile(job.zipPath)) === job.httpDownload.completedSha256;
      if (
        complete &&
        !job.requiresConfirmation &&
        !["paused", "cancelled", "error"].includes(job.status)
      ) {
        await processJob(job, !!job.oversizeConfirmed);
      } else {
        if (complete && source) {
          job.downloadedBytes = source.size;
        } else if (job.httpDownload) {
          job.httpDownload.completedSha256 = "";
          job.downloadedBytes = await reconcileHttpFiles(job.zipPath, job.httpDownload);
        } else job.downloadedBytes = 0;
        await rm(`${job.zipPath}.assembling`, { force: true });
        job.sessionId = "";
        if (!["awaiting_confirmation", "cancelled", "error"].includes(job.status))
          Object.assign(job, {
            status: "paused",
            phase: "paused",
            canResume: true,
            percent: null,
            message: "Restored download. Resume to verify the source and fetch missing bytes.",
          });
      }
    } catch (error) {
      Object.assign(job, {
        status: "error",
        phase: "error",
        canResume: false,
        error: error instanceof Error ? error.message : "Could not restore HTTP download.",
        message: "Stored HTTP download could not be verified.",
        sessionId: "",
      });
    }
    saveRetainedTorrent(store, job);
  }
}

function hydrateHttpJob(
  snapshot: ReturnType<RetainedTorrentStore["readHttp"]>[number],
  directory: string,
): SessionJob {
  const workspaceDir = path.join(directory, snapshot.id);
  const job: SessionJob = {
    ...snapshot,
    downloadOptions: normalizeDownloadOptions(snapshot.downloadOptions),
    storageRoot: directory,
    workspaceDir,
    zipPath: "",
    extractDir: path.join(workspaceDir, "extracted"),
    abortController: null,
    pauseRequested: false,
    cleanupAt: 0,
    subscribers: new Set(),
    socketSubscribers: new Set(),
    extractedEntries: 0,
    totalEntries: 0,
    transcodedEntries: 0,
    totalTranscodeEntries: 0,
    isStalled: false,
    stallDurationMs: 0,
    videoQuality: "720p",
    enableResume: true,
    enableMultithread: true,
    canPause: false,
    downloadSpeedBytesPerSec: 0,
    averageSpeedBytesPerSec: 0,
    etaSeconds: null,
  };
  job.zipPath = httpSourcePath(job);
  if (!job.requiresConfirmation || !job.reportedSize)
    job.reportedSize = job.httpDownload?.size || job.reportedSize;
  return job;
}
