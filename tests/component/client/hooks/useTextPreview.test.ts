import { act, renderHook, waitFor } from "@testing-library/react";
import { useTextPreview } from "../../../../client/src/hooks/useTextPreview";

const chunk = {
  text: "new content",
  offset: 0,
  nextOffset: 11,
  totalBytes: 11,
  encoding: "utf-8",
  binary: false,
  replacementCharacters: false,
};
const props = {
  selectedNode: { path: "first.txt" },
  selectedKind: "text",
  selectedPreviewUrl: "/file?path=first.txt",
  sessionId: "one",
};

afterEach(() => vi.unstubAllGlobals());

it("hides the previous selection immediately and ignores stale completions", async () => {
  let finishFirst = (_value: Response) => {};
  let firstSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    if (_url.includes("first.txt")) {
      firstSignal = init.signal as AbortSignal;
      return new Promise<Response>((resolve) => {
        finishFirst = resolve;
      });
    }
    return Promise.resolve(Response.json(chunk));
  });
  const { result, rerender } = renderHook(useTextPreview, { initialProps: props });
  rerender({
    ...props,
    selectedNode: { path: "second.txt" },
    selectedPreviewUrl: "/file?path=second.txt",
  });
  await waitFor(() => expect(result.current.textPreview.chunk?.text).toBe("new content"));
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => {
    finishFirst(Response.json({ ...chunk, text: "stale" }));
    await Promise.resolve();
  });
  expect(result.current.textPreview.chunk?.text).toBe("new content");
  rerender({ ...props, selectedNode: { path: "image.png" }, selectedKind: "image" });
  expect(result.current.textPreview.chunk).toBeNull();
});

it("aborts pending work on reset and cache clear", () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const { result, unmount } = renderHook(useTextPreview, { initialProps: props });
  act(() => result.current.resetTextPreview());
  expect(signal?.aborted).toBe(true);
  act(() => result.current.clearTextPreviewCache());
  expect(result.current.textPreview.chunk).toBeNull();
  unmount();
});
