import { describe, expect, it } from "vite-plus/test";
import { loadTextPreview } from "../../../../../client/src/features/workspace/textPreviewLoader";
import type { TextPreviewChunk } from "../../../../../shared/contracts";

const chunk: TextPreviewChunk = {
  text: "hello",
  offset: 0,
  nextOffset: 5,
  totalBytes: 5,
  encoding: "utf-8",
  binary: false,
  replacementCharacters: false,
};
const params = () => ({
  cache: new Map<string, TextPreviewChunk>(),
  cacheKey: "session:file.txt",
  previewUrl: "/preview?path=file.txt&preview=1",
  offset: 0,
  signal: new AbortController().signal,
});

describe("text preview loading", () => {
  it("requests a bounded chunk, validates it and caches the result", async () => {
    const options = params();
    let requested = "";
    const result = await loadTextPreview({
      ...options,
      request: (url) => {
        requested = url;
        return Promise.resolve(Response.json(chunk));
      },
    });
    expect(result).toEqual(chunk);
    expect(requested).toContain("textPreview=1");
    expect(requested).not.toContain("preview=1");
    expect([...options.cache.values()]).toEqual([chunk]);
    await expect(
      loadTextPreview({
        ...options,
        request: () => {
          throw new Error("Cache missed");
        },
      }),
    ).resolves.toEqual(chunk);
  });

  it("evicts least recently read entries by retained string bytes, including keys", async () => {
    const options = params();
    const large = { ...chunk, text: "a".repeat(131072), nextOffset: 131072, totalBytes: 131072 };
    for (let i = 0; i < 12; i++)
      await loadTextPreview({
        ...options,
        cacheKey: `file${i}`,
        request: () => Promise.resolve(Response.json(large)),
      });
    expect(options.cache.size).toBeLessThan(9);
    expect([...options.cache.keys()].some((key) => key.startsWith("file0:"))).toBe(false);
    expect([...options.cache.keys()].some((key) => key.startsWith("file11:"))).toBe(true);
  });

  it("never repopulates a cleared cache after cancellation", async () => {
    const options = params();
    const controller = new AbortController();
    const pending = loadTextPreview({
      ...options,
      signal: controller.signal,
      request: () => {
        controller.abort();
        options.cache.clear();
        return Promise.resolve(Response.json(chunk));
      },
    });
    await expect(pending).rejects.toThrow();
    expect(options.cache.size).toBe(0);
  });

  it.each([
    new Response("failed", { status: 500 }),
    Response.json({ ...chunk, nextOffset: 900000 }),
    Response.json({ ...chunk, text: "a".repeat(131073) }),
    new Response("x".repeat(1100000)),
  ])("rejects failed, oversized or invalid responses", async (response) => {
    await expect(
      loadTextPreview({ ...params(), request: () => Promise.resolve(response) }),
    ).rejects.toThrow();
  });
});
