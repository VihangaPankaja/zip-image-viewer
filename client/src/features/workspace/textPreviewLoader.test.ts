import { describe, expect, it, vi } from "vitest";
import { loadTextPreview } from "./textPreviewLoader";

describe("text preview loading", () => {
  it("returns cached content without another request", async () => {
    const cache = new Map([["session:file.txt", "cached"]]);
    const request = vi.fn();

    await expect(
      loadTextPreview({
        cache,
        cacheKey: "session:file.txt",
        previewUrl: "/unused",
        request,
      }),
    ).resolves.toBe("cached");
    expect(request).not.toHaveBeenCalled();
  });

  it("caches a successful response", async () => {
    const cache = new Map<string, string>();
    const request = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("hello"),
    });

    await expect(
      loadTextPreview({
        cache,
        cacheKey: "session:file.txt",
        previewUrl: "/preview",
        request,
      }),
    ).resolves.toBe("hello");
    expect(cache.get("session:file.txt")).toBe("hello");
  });

  it("rejects a failed response with the user-facing message", async () => {
    await expect(
      loadTextPreview({
        cache: new Map(),
        cacheKey: "session:file.txt",
        previewUrl: "/preview",
        request: () =>
          Promise.resolve({ ok: false, text: () => Promise.resolve("") }),
      }),
    ).rejects.toThrow("Could not read this file.");
  });
});
