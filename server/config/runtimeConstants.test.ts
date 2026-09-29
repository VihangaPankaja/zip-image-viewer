import { describe, expect, it } from "vitest";
import { parseRuntimeEnvironment } from "./runtimeConstants.js";

describe("parseRuntimeEnvironment", () => {
  it("uses safe defaults", () => {
    expect(parseRuntimeEnvironment({})).toEqual({
      port: 8080,
      mediaCacheBudgetBytes: 1024 ** 3,
    });
  });

  it.each(["0", "65536", "NaN", "1.5"])("rejects invalid port %s", (port) => {
    expect(() => parseRuntimeEnvironment({ PORT: port })).toThrow();
  });

  it("accepts a valid TCP port", () => {
    expect(parseRuntimeEnvironment({ PORT: "3000" })).toEqual({
      port: 3000,
      mediaCacheBudgetBytes: 1024 ** 3,
    });
  });

  it("accepts a configurable media cache budget and rejects invalid values", () => {
    expect(
      parseRuntimeEnvironment({ MEDIA_CACHE_BUDGET_BYTES: "4096" })
        .mediaCacheBudgetBytes,
    ).toBe(4096);
    expect(() =>
      parseRuntimeEnvironment({ MEDIA_CACHE_BUDGET_BYTES: "-1" }),
    ).toThrow();
  });
});
