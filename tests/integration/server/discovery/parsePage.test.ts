import { expect, it } from "vite-plus/test";
import { parsePage } from "../../../../server/infrastructure/discovery/parsePage.js";

it("terminates pathological parsing without blocking the server event loop", async () => {
  const markup = "<span>".repeat(24_000) + "</x>".repeat(24_000) + '<a href="/file.zip">File</a>';
  let timerRan = false;
  const timer = setTimeout(() => {
    timerRan = true;
  }, 20);
  const started = Date.now();
  try {
    await expect(
      parsePage(markup, "https://example.com/", AbortSignal.timeout(1500)),
    ).rejects.toThrow();
    expect(timerRan).toBe(true);
    expect(Date.now() - started).toBeLessThan(4000);
  } finally {
    clearTimeout(timer);
  }
});

it("parses ordinary pages in a worker and rejects an already cancelled operation", async () => {
  const signal = AbortSignal.timeout(5000);
  const result = await parsePage(
    '<a download href="/get">File</a>',
    "https://example.com/",
    signal,
  );
  expect(result.items[0]?.kind).toBe("file");
  await expect(parsePage("", "https://example.com/", AbortSignal.abort())).rejects.toThrow();
});
