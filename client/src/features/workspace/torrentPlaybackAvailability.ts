import type { Job, TorrentFile } from "../../../../shared/contracts";

export function canContinueTorrentPlayback(job: Job, file: TorrentFile) {
  return (
    job.sourceKind === "torrent" &&
    file.selected &&
    ((job.status === "downloading" && job.phase === "downloading") ||
      (file.complete &&
        (job.status === "ready" || (job.status === "downloading" && job.phase === "indexing"))))
  );
}
