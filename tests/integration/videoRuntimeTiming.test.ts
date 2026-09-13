import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it, vi } from "vitest";
import { createVideoRuntime } from "../../server/infrastructure/media/videoRuntime.js";
import { runCommand } from "../../server/infrastructure/process/commandRunner.js";
import type {
  Session,
  VideoTranscodeEntry,
} from "../../server/domain/models.js";

describe("video runtime timing", () => {
  it("records encoder queue and execution time for a completed rendition", async () => {
    if (!ffmpegPath) throw new Error("ffmpeg-static is unavailable.");
    const workspaceDir = await mkdtemp(path.join(tmpdir(), "ziv-timing-"));
    const sourcePath = path.join(workspaceDir, "source.mp4");
    const events: Array<{ event: string; details?: Record<string, unknown> }> =
      [];
    const session: Session = {
      id: "timing-session",
      workspaceDir,
      extractDir: workspaceDir,
      tree: {
        name: "source.mp4",
        path: "source.mp4",
        type: "file",
        extension: "mp4",
        modifiedAt: 0,
      },
      firstFilePath: "source.mp4",
      stats: { fileCount: 1 },
      selectedVideoQuality: "360p",
      transcodeStatus: {
        quality: "360p",
        done: false,
        completed: 0,
        total: 1,
      },
      lastAccessedAt: Date.now(),
    };

    try {
      await runCommand(ffmpegPath, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=30:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=48000:duration=2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        sourcePath,
      ]);
      const runtime = createVideoRuntime({
        ffmpegPath,
        transcodes: new Map<string, VideoTranscodeEntry>(),
        logEvent: (_level, event, details) => events.push({ event, details }),
      });
      const entry = await runtime.ensureVideoTranscodeEntry(
        session,
        "source.mp4",
        sourcePath,
      );
      const rendition = runtime.getRenditionState(entry, session, "360p");

      await runtime.startRenditionTranscode(entry, session, rendition);
      await vi.waitFor(() => expect(rendition.status).toBe("done"), {
        timeout: 30_000,
      });

      expect(events.map(({ event }) => event)).toEqual([
        "video.transcode.queued",
        "video.transcode.started",
        "video.transcode.completed",
      ]);
      expect(events.at(-1)?.details).toMatchObject({
        sessionId: session.id,
        path: "source.mp4",
        quality: "360p",
        cache: "miss",
      });
      expect(events.at(-1)?.details?.queueMs).toEqual(expect.any(Number));
      expect(events.at(-1)?.details?.encodeMs).toEqual(expect.any(Number));
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  }, 45_000);
});
