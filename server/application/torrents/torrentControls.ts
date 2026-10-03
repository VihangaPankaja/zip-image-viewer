import type {
  TorrentLimits,
  TorrentPriority,
} from "../../../shared/contracts.js";
import { ApplicationError, type SessionJob } from "../../domain/models.js";
import { createWebTorrentAdapter } from "./torrentDownloader.js";

export function createTorrentControls(
  jobs: Map<string, SessionJob>,
  emitJob: (_job: SessionJob, _patch: Partial<SessionJob>) => void,
) {
  const torrentAdapter = createWebTorrentAdapter();
  return {
    torrentAdapter,
    setTorrentFilePriority: (
      jobId: string,
      fileId: string,
      priority: TorrentPriority,
    ) => {
      const job = jobs.get(jobId);
      if (!job) throw new ApplicationError("NOT_FOUND", "Job not found.", 404);
      const file = job.torrentFiles.find(({ id }) => id === fileId);
      if (
        job.sourceKind !== "torrent" ||
        job.status !== "downloading" ||
        !file?.selected
      )
        throw new ApplicationError(
          "CONFLICT",
          "Selected torrent file is not actively downloading.",
          409,
        );
      torrentAdapter.setFilePriority?.(jobId, fileId, priority);
      file.priority = priority;
      emitJob(job, {});
      return job;
    },
    getTorrentLimits: () =>
      torrentAdapter.getLimits?.() ?? {
        downloadBytesPerSec: 0,
        uploadBytesPerSec: 0,
      },
    updateTorrentLimits: (limits: TorrentLimits) =>
      torrentAdapter.setLimits?.(limits) ?? limits,
  };
}
