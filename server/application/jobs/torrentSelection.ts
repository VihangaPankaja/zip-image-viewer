import { ApplicationError, type SessionJob } from "../../domain/models.js";
import { groupArchiveVolumes } from "../../../shared/archiveVolumes.js";

export function selectTorrentVolumes(job: SessionJob, fileIds: string[]) {
  if (
    job.sourceKind !== "torrent" ||
    !["awaiting_selection", "ready", "paused"].includes(job.status)
  ) {
    throw new ApplicationError("CONFLICT", "Job is not awaiting file selection.", 409);
  }
  const ids = new Set(fileIds);
  const known = new Set(job.torrentFiles.map((file) => file.id));
  if (!ids.size || ids.size !== fileIds.length || fileIds.some((id) => !known.has(id))) {
    throw new ApplicationError("INVALID_INPUT", "Choose one or more known torrent files.", 400);
  }
  for (const group of groupArchiveVolumes(job.torrentFiles, (file) => file.path))
    if (group.some((file) => ids.has(file.id))) for (const file of group) ids.add(file.id);
  job.torrentFiles = job.torrentFiles.map((file) => ({
    ...file,
    selected: ids.has(file.id) || (job.status !== "awaiting_selection" && file.selected),
  }));
  Object.assign(job, {
    status: "queued",
    phase: "queued",
    cleanupAt: 0,
    reportedSize: job.torrentFiles
      .filter((file) => file.selected)
      .reduce((total, file) => total + file.size, 0),
    message: "File selection accepted. Waiting to start.",
  });
}
