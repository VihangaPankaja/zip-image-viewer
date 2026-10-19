import { describe, expect, it } from "vite-plus/test";
import {
  AUTO_QUALITY,
  createAdaptiveHlsConfig,
  loadHlsModule,
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

  it("keeps retrying a preparing playlist without retrying terminal failures forever", async () => {
    const { default: Hls } = await loadHlsModule();
    const original = Hls.DefaultConfig.playlistLoadPolicy;
    const policy = createAdaptiveHlsConfig(Hls.DefaultConfig.playlistLoadPolicy)
      .playlistLoadPolicy?.default.errorRetry;
    expect(policy?.maxNumRetry).toBe(original.default.errorRetry?.maxNumRetry);
    expect(
      policy?.shouldRetry?.(null, 0, false, { url: "", code: 425 }, false),
    ).toBe(false);
    expect(
      policy?.shouldRetry?.(policy, 20, false, { url: "", code: 425 }, false),
    ).toBe(true);
    expect(20 < (policy?.maxNumRetry ?? 0)).toBe(true);
    expect(
      policy?.shouldRetry?.(policy, 20, false, { url: "", code: 503 }, false),
    ).toBe(false);
    expect(20 >= (policy?.maxNumRetry ?? 0)).toBe(true);
    expect(
      policy?.shouldRetry?.(policy, 20, false, { url: "", code: 503 }, true),
    ).toBe(false);
    expect(
      policy?.shouldRetry?.(policy, 0, false, { url: "", code: 503 }, true),
    ).toBe(true);
    expect(
      policy?.shouldRetry?.(policy, 0, false, { url: "", code: 404 }, false),
    ).toBe(false);
    expect(policy?.shouldRetry?.(policy, 20, true, undefined, false)).toBe(
      false,
    );
    expect(original.default.errorRetry?.shouldRetry).toBeUndefined();
    expect(
      createAdaptiveHlsConfig({
        default: { ...original.default, errorRetry: null },
      }).playlistLoadPolicy?.default.errorRetry,
    ).toBeNull();
  });

  it("maps Auto to the HLS.js automatic level", () => {
    expect(resolveManualLevel(AUTO_QUALITY, [360, 480, 720])).toBe(-1);
  });

  it("maps a manual height to the closest available level", () => {
    expect(resolveManualLevel("720p", [360, 480, 720, 1080])).toBe(2);
    expect(resolveManualLevel("900p", [360, 480, 720, 1080])).toBe(2);
  });

  it("falls back to automatic selection for invalid or unavailable levels", () => {
    expect(resolveManualLevel("invalid", [360, 720])).toBe(-1);
    expect(resolveManualLevel("720p", [])).toBe(-1);
  });

  it("loads the player module lazily with its expected API", async () => {
    const { default: Hls } = await loadHlsModule();
    expect(typeof Hls.isSupported).toBe("function");
  });
});
