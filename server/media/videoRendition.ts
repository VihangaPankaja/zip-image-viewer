import crypto from "node:crypto";
import path from "node:path";
import type {
  Session,
  VideoRendition,
  VideoTranscodeEntry,
} from "../domain/models.js";

export function getRenditionState(
  entry: VideoTranscodeEntry,
  session: Session,
  qualityId: string,
): VideoRendition {
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
  const dir = path.join(session.workspaceDir, "video-transcodes", hash);
  const rendition: VideoRendition = {
    qualityId,
    selectedHeight: height,
    dir,
    playlistPath: path.join(dir, "index.m3u8"),
    status: "idle",
    process: null,
    priorityJobs: new Map(),
    availableSegments: 0,
    expectedSegments: entry.expectedSegments,
    durationSeconds: entry.durationSeconds,
  };
  entry.renditions.set(qualityId, rendition);
  return rendition;
}
