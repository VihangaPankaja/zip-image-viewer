import { describe, expect, it } from "vite-plus/test";
import { jobSchema, type Job } from "../../../../../shared/contracts";
import {
  buildWorkspaceRailItems,
  livePreviewFiles,
} from "../../../../../client/src/features/workspace/workspaceRail";

const job = jobSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  url: "https://example.com/archive.zip",
  status: "downloading",
  phase: "downloading",
  percent: 20,
  createdAt: 0,
  updatedAt: 0,
});
const file = {
  id: "video",
  path: "episode.mp4",
  selected: true,
  size: 100,
  downloadedBytes: 20,
  complete: false,
};
const torrent: Job = { ...job, sourceKind: "torrent", torrentFiles: [file] };
const live = { jobId: job.id, fileId: file.id };
const session = {
  id: "00000000-0000-4000-8000-000000000002",
  fileCount: 2,
  firstFilePath: "ready.jpg",
  lastAccessedAt: 0,
};

describe("preview rail availability", () => {
  it.each(["queued", "paused", "error", "cancelled", "extracting", "ready"] as const)(
    "excludes %s HTTP jobs even with a stale live capability",
    (status) => {
      expect(buildWorkspaceRailItems([{ ...job, status }], [], [live])).toEqual([]);
    },
  );
  it("requires a validated live capability for a selected active torrent video", () => {
    expect(buildWorkspaceRailItems([torrent], [], [])).toEqual([]);
    expect(buildWorkspaceRailItems([torrent], [], [live])).toEqual([
      expect.objectContaining({ id: job.id, livePreview: live, label: file.path }),
    ]);
    for (const unavailable of [
      { ...torrent, status: "paused" as const },
      { ...torrent, phase: "extracting" as const },
      { ...torrent, torrentFiles: [{ ...file, selected: false }] },
      { ...torrent, torrentFiles: [{ ...file, path: "archive.zip" }] },
    ])
      expect(buildWorkspaceRailItems([unavailable], [], [live])).toEqual([]);
    expect(
      livePreviewFiles({ ...torrent, torrentFiles: [{ ...file, path: "MOVIE.M4V" }] }),
    ).toHaveLength(1);
  });
  it("deduplicates job/session aliases by owning session ID, preferring ready files", () => {
    const owned = { ...torrent, sessionId: session.id };
    expect(buildWorkspaceRailItems([owned], [], [live])[0]?.id).toBe(session.id);
    const items = buildWorkspaceRailItems(
      [owned, { ...owned, id: "another-job" }],
      [session, session],
      [live, { ...live, jobId: "another-job" }],
    );
    expect(items).toEqual([
      { id: session.id, label: "ready.jpg", state: "ready", detail: "2 files" },
    ]);
    expect(buildWorkspaceRailItems([], [session], [])).toEqual(items);
  });
  it("excludes empty sessions and unknown files/jobs", () => {
    expect(
      buildWorkspaceRailItems(
        [torrent],
        [{ ...session, fileCount: 0 }],
        [
          { ...live, jobId: "unknown" },
          { ...live, fileId: "unknown" },
        ],
      ),
    ).toEqual([]);
  });
});
