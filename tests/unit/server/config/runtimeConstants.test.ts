import { describe, expect, it } from "vite-plus/test";
import { parseRuntimeEnvironment } from "../../../../server/config/runtimeConstants.js";

describe("parseRuntimeEnvironment", () => {
  it("uses safe defaults", () => {
    expect(parseRuntimeEnvironment({})).toEqual({
      port: 8080,
      mediaCacheBudgetBytes: 1024 ** 3,
      hlsEncoder: "cpu",
    });
  });

  it.each(["0", "65536", "NaN", "1.5"])("rejects invalid port %s", (port) => {
    expect(() => parseRuntimeEnvironment({ PORT: port })).toThrow();
  });

  it("accepts a valid TCP port", () => {
    expect(parseRuntimeEnvironment({ PORT: "3000" })).toEqual({
      port: 3000,
      mediaCacheBudgetBytes: 1024 ** 3,
      hlsEncoder: "cpu",
    });
  });

  it("accepts a configurable media cache budget and rejects invalid values", () => {
    expect(
      parseRuntimeEnvironment({ MEDIA_CACHE_BUDGET_BYTES: "4096" }).mediaCacheBudgetBytes,
    ).toBe(4096);
    expect(() => parseRuntimeEnvironment({ MEDIA_CACHE_BUDGET_BYTES: "-1" })).toThrow();
  });

  it("accepts only supported opt-in HLS encoder preferences", () => {
    for (const value of ["cpu", "auto", "h264_qsv", "h264_nvenc"])
      expect(parseRuntimeEnvironment({ HLS_ENCODER: value }).hlsEncoder).toBe(value);
    expect(() => parseRuntimeEnvironment({ HLS_ENCODER: "arbitrary" })).toThrow();
  });
});
