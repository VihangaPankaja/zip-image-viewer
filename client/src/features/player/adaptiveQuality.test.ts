import { describe, expect, it } from "vitest";
import {
  AUTO_QUALITY,
  createAdaptiveHlsConfig,
  resolveManualLevel,
} from "./adaptiveQuality";

describe("adaptive player quality", () => {
  it("starts in automatic ABR mode with a bounded buffer", () => {
    expect(createAdaptiveHlsConfig()).toMatchObject({
      startLevel: -1,
      capLevelToPlayerSize: true,
      capLevelOnFPSDrop: true,
      maxBufferLength: 30,
      backBufferLength: 30,
    });
  });

  it("maps Auto to the HLS.js automatic level", () => {
    expect(resolveManualLevel(AUTO_QUALITY, [360, 480, 720])).toBe(-1);
  });

  it("maps a manual height to the closest available level", () => {
    expect(resolveManualLevel("720p", [360, 480, 720, 1080])).toBe(2);
    expect(resolveManualLevel("900p", [360, 480, 720, 1080])).toBe(2);
  });
});
