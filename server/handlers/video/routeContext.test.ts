import { describe, expect, test } from "vitest";
import { selectVideoQuality } from "./routeContext.js";

describe("selectVideoQuality", () => {
  test("selects a supported quality and falls back to source", () => {
    const options = [
      { id: "source", label: "Source", height: 1080 },
      { id: "720p", label: "720p", height: 720 },
    ];

    expect(selectVideoQuality(options, "720p")).toEqual({
      quality: "720p",
      height: 720,
    });
    expect(selectVideoQuality(options, "bogus")).toEqual({
      quality: "source",
      height: 0,
    });
  });
});
