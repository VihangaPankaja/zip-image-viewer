import { expect, it } from "vitest";
import {
  durationFromOutput,
  dimensionsFromOutput,
  qualityOptions,
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
  ).toBe("source");
});
