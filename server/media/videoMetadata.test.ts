import { expect, it } from "vitest";
import {
  durationFromOutput,
  dimensionsFromOutput,
  qualityOptions,
  playbackModeFromOutput,
} from "./videoMetadata.js";
it("parses FFmpeg metadata and tolerates absent or malformed video details", () => {
  expect(durationFromOutput("Duration: 01:02:03.25")).toBe(3723.25);
  expect(durationFromOutput("Duration: N/A")).toBe(0);
  expect(dimensionsFromOutput("Audio: aac\nVideo: h264, 1920x1080")).toEqual({
    width: 1920,
    height: 1080,
  });
  expect(dimensionsFromOutput("Audio: aac")).toEqual({ width: 0, height: 0 });
  expect(dimensionsFromOutput("Video: unknown")).toEqual({
    width: 0,
    height: 0,
  });
  expect(
    qualityOptions({ width: 1920, height: 1080, durationSeconds: 1 })
      .defaultQuality,
  ).toBe("720p");
  expect(
    qualityOptions({ width: 320, height: 180, durationSeconds: 1 })
      .defaultQuality,
  ).toBe("auto");
});

it("chooses direct MP4, remux, or transcode from the probed streams", () => {
  const streams =
    "Stream #0:0: Video: h264 (High), yuv420p(progressive), 640x360\n" +
    "Stream #0:1: Audio: aac (LC), 48000 Hz, stereo";
  expect(
    playbackModeFromOutput(
      `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':\n${streams}`,
      "mp4",
    ),
  ).toBe("direct");
  expect(
    playbackModeFromOutput(
      `Input #0, matroska,webm, from 'clip.mkv':\n${streams}`,
      "mkv",
    ),
  ).toBe("remux");
  expect(
    playbackModeFromOutput(
      `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':\n${streams.replace("h264", "hevc")}`,
      "mp4",
    ),
  ).toBe("transcode");
  expect(
    playbackModeFromOutput(
      `Input #0, matroska,webm, from 'clip.mkv':\n${streams.replace("aac", "opus")}`,
      "mkv",
    ),
  ).toBe("transcode");
});
