import { describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  isTerminalJobStatus,
  logEvent,
  parseRangeHeader,
  sanitizeEntryPath,
} from "./runtimePrimitives.js";

describe("runtime primitives", () => {
  it("parses bounded, open-ended, and suffix byte ranges", () => {
    expect(parseRangeHeader("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
    expect(parseRangeHeader("bytes=8-", 10)).toEqual({ start: 8, end: 9 });
    expect(parseRangeHeader("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRangeHeader("bytes=0-99", 10)).toEqual({ start: 0, end: 9 });
  });

  it.each([
    [undefined, null],
    ["items=0-2", null],
    ["bytes=0-1,3-4", null],
    ["bytes=-0", "invalid"],
    ["bytes=10-11", "invalid"],
    ["bytes=5-2", "invalid"],
  ] as const)("rejects malformed range %s", (header, expected) => {
    expect(parseRangeHeader(header, 10)).toBe(expected);
  });

  it("normalizes safe archive paths and rejects traversal", () => {
    expect(sanitizeEntryPath("\\folder\\image.jpg/")).toBe("folder/image.jpg");
    expect(() => sanitizeEntryPath("../secret.txt")).toThrow("Unsafe entry");
    expect(() => sanitizeEntryPath(".")).toThrow("Unsafe entry");
  });

  it("formats byte sizes and recognizes terminal jobs", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(isTerminalJobStatus("ready")).toBe(true);
    expect(isTerminalJobStatus("downloading")).toBe(false);
  });

  it("writes structured events to the selected logger", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logEvent("warn", "fixture", { jobId: "job-1" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[WARN] fixture {"jobId":"job-1"}'),
    );
    warn.mockRestore();
  });
});
