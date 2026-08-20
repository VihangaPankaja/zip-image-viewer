import { describe, expect, it } from "vitest";
import {
  classifyDetectedType,
  classifyMimeType,
  errorFromUnknown,
  isArchiveByName,
  isRecord,
  parseSeekSeconds,
  shouldPreserveOriginalPreview,
  sleepWithSignal,
} from "./mediaClassification.js";

describe("media classification", () => {
  it.each([
    ["bundle.ZIP", true],
    ["bundle", false],
    [null, false],
  ])("classifies archive names", (value, expected) => {
    expect(isArchiveByName(value)).toBe(expected);
  });

  it.each([
    ["movie.unknown", { ext: "mkv", mime: "video/x-matroska" }, "video"],
    ["track.mp3", undefined, "audio"],
    ["photo.png", undefined, "image"],
    ["data.json", undefined, "text"],
    ["archive.bin", { ext: "zip", mime: "application/zip" }, "archive"],
    ["blob.unknown", undefined, "binary"],
  ] as const)("classifies detected type for %s", (file, detected, expected) => {
    expect(classifyDetectedType(file, detected)).toBe(expected);
  });

  it("classifies preview MIME types and preservation policy", () => {
    expect(classifyMimeType("image/webp")).toBe("image");
    expect(classifyMimeType("application/json")).toBe("text");
    expect(classifyMimeType("application/octet-stream")).toBe("binary");
    expect(shouldPreserveOriginalPreview("image/svg+xml")).toBe(true);
    expect(shouldPreserveOriginalPreview("image/jpeg")).toBe(false);
  });

  it("normalizes seek values and unknown errors", () => {
    expect(parseSeekSeconds("12.5")).toBe(12.5);
    expect(parseSeekSeconds(-1)).toBe(0);
    expect(parseSeekSeconds({})).toBe(0);
    expect(errorFromUnknown(new Error("known")).message).toBe("known");
    expect(errorFromUnknown("unknown").message).toBe("Unexpected error");
    expect(isRecord({ id: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
  });

  it("resolves immediate waits and rejects cancelled waits", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sleepWithSignal(10, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(
      sleepWithSignal(0, new AbortController().signal),
    ).resolves.toBe(undefined);
  });
});
