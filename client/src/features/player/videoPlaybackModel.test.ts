import { describe, expect, it } from "vitest";
import {
  buildVideoPlaybackUrls,
  chooseVideoQuality,
  normalizeVideoQualityOptions,
} from "./videoPlaybackModel";

describe("video playback model", () => {
  it("builds encoded source and HLS URLs for selected video files", () => {
    expect(
      buildVideoPlaybackUrls({
        sessionId: "session-1",
        selectedKind: "video",
        selectedNode: { type: "file", path: "folder/a&b.mp4" },
        quality: "720p",
      }),
    ).toEqual({
      hlsUrl:
        "/api/sessions/session-1/video/hls/playlist?path=folder%2Fa%26b.mp4&quality=720p",
      originalUrl:
        "/api/sessions/session-1/video/play?path=folder%2Fa%26b.mp4&quality=source",
    });
  });

  it("returns empty URLs outside a selected video file", () => {
    expect(
      buildVideoPlaybackUrls({
        sessionId: "session-1",
        selectedKind: "image",
        selectedNode: { type: "file", path: "cover.jpg" },
        quality: "source",
      }),
    ).toEqual({ hlsUrl: "", originalUrl: "" });
  });

  it("normalizes options and falls back to source quality", () => {
    const options = normalizeVideoQualityOptions([
      { id: "source", label: "" },
      { id: "720p", label: "HD" },
    ]);

    expect(options).toEqual([
      { id: "source", label: "source" },
      { id: "720p", label: "HD" },
    ]);
    expect(chooseVideoQuality(options, "missing")).toBe("source");
  });
});
