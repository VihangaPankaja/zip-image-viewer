import path from "node:path";
import type { SessionJob } from "../../domain/models.js";
import type { RetainedTorrentStore } from "../../repositories/retainedTorrents.js";
import type { TorrentAdapter } from "./torrentDownloader.js";
import { normalizeDownloadOptions } from "../downloads/downloadOptions.js";

export async function restoreRetainedTorrents(
  store: RetainedTorrentStore,
  jobs: Map<string, SessionJob>,
  adapter: TorrentAdapter,
  restoreSession: (_job: SessionJob) => Promise<unknown>,
) {
  for (const { job: snapshot, metadata } of store.read()) {
    const job = hydrateTorrent({ job: snapshot, metadata }, store.directory);
    jobs.set(job.id, job);
    job.torrentFiles = job.torrentFiles.map((file) => ({
      ...file,
      complete: false,
      downloadedBytes: 0,
    }));
    try {
      await checkTorrent(job, snapshot.torrentFiles, adapter);
      const selected = job.torrentFiles.filter(({ selected }) => selected);
      if (job.sessionId && selected.some(({ complete }) => complete))
        await restoreSession(job);
      Object.assign(job, { status: snapshot.status, phase: snapshot.phase });
      if (
        snapshot.status === "ready" &&
        metadata &&
        selected.length &&
        selected.every(({ complete }) => complete)
      ) {
        job.message =
          "Retained torrent files are verified and ready to browse.";
      } else if (
        ![
          "awaiting_selection",
          "awaiting_confirmation",
          "error",
          "cancelled",
        ].includes(job.status)
      ) {
        Object.assign(job, {
          status: "paused",
          phase: "paused",
          canPause: false,
          canResume: true,
          downloadedBytes: selected.reduce(
            (sum, file) => sum + file.downloadedBytes,
            0,
          ),
          percent: null,
          peerCount: 0,
          downloadSpeedBytesPerSec: 0,
          uploadSpeedBytesPerSec: 0,
          message:
            "Restored download. Resume to recheck and fetch missing pieces.",
        });
      }
      store.save(job);
    } catch (error) {
      Object.assign(job, {
        status: "error",
        phase: "error",
        canPause: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not restore torrent data.",
        message:
          "Stored torrent data could not be verified. Download files again to recover.",
      });
      store.save(job);
    }
  }
}

function hydrateTorrent(
  { job: snapshot, metadata }: ReturnType<RetainedTorrentStore["read"]>[number],
  directory: string,
): SessionJob {
  const workspaceDir = path.join(directory, snapshot.id);
  return {
    ...snapshot,
    downloadOptions: normalizeDownloadOptions(snapshot.downloadOptions),
    extractedEntries: 0,
    totalEntries: 0,
    isStalled: false,
    stallDurationMs: 0,
    enableMultithread: false,
    enableResume: true,
    transcodedEntries: 0,
    totalTranscodeEntries: 0,
    videoQuality: "720p",
    workspaceDir,
    extractDir: path.join(workspaceDir, "extracted"),
    zipPath: "",
    torrentMetadata: metadata,
    cleanupAt: 0,
    pauseRequested: false,
    abortController: null,
    subscribers: new Set(),
    socketSubscribers: new Set(),
  };
}

async function checkTorrent(
  job: SessionJob,
  originalFiles: SessionJob["torrentFiles"],
  adapter: TorrentAdapter,
) {
  if (job.torrentMetadata) {
    const checked = new Error("Existing torrent data checked");
    await adapter
      .download({
        source: job.torrentMetadata,
        downloadDir: path.join(job.workspaceDir, "torrent"),
        signal: new AbortController().signal,
        retainStoreOnAbort: () => true,
        onProgress: () => undefined,
        onNoPeers: () => undefined,
        onMetadata: ({ files }) => {
          job.torrentFiles = files.map((file) => ({
            ...file,
            selected: originalFiles.some(
              (saved) => saved.id === file.id && saved.selected,
            ),
            priority:
              originalFiles.find((saved) => saved.id === file.id)?.priority ??
              "normal",
          }));
          throw checked;
        },
      })
      .catch((error: unknown) => {
        if (error !== checked) throw error;
      });
  }
}
