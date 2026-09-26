import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useImagePreviewCache } from "./useImagePreviewCache";

const initial = {
  sessionId: "session-a",
  selectedNode: null as { path: string } | null,
  selectedKind: "image",
  previewQuality: "balanced",
  selectedImagePreviewUrl: "/fallback.jpg",
};
const response = () => new Response(new Blob(["image"]));
const createObjectURL = vi.fn(() => "blob:preview");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shares pending previews and releases their URLs on unmount", async () => {
  const { result, unmount } = renderHook(() => useImagePreviewCache(initial));
  const previews = await Promise.all([
    result.current.loadImagePreview("photo.jpg", "balanced"),
    result.current.loadImagePreview("photo.jpg", "balanced"),
  ]);
  expect(previews).toEqual(["blob:preview", "blob:preview"]);
  expect(await result.current.loadImagePreview("photo.jpg", "balanced")).toBe(
    "blob:preview",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  unmount();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});

it("does not recreate an image URL after its session cache is cleared", async () => {
  let finish!: (value: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = renderHook(() => useImagePreviewCache(initial));
  const pending = result.current.loadImagePreview("photo.jpg", "balanced");
  act(() => result.current.clearImagePreviewCache());
  finish(response());
  expect(await pending).toBe("");
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(await result.current.loadImagePreview("photo.jpg", "balanced")).toBe(
    "blob:preview",
  );
});

it("keeps a replacement request when an older cleared request fails", async () => {
  let fail!: (reason: Error) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const { result } = renderHook(() => useImagePreviewCache(initial));
  const pending = result.current.loadImagePreview("photo.jpg", "balanced");
  const failure = expect(pending).rejects.toThrow("offline");
  act(() => result.current.clearImagePreviewCache());
  await result.current.loadImagePreview("photo.jpg", "balanced");
  fail(new Error("offline"));
  await failure;
  await result.current.loadImagePreview("photo.jpg", "balanced");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("falls back on HTTP failure, then retries instead of caching failure", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }));
  const { result } = renderHook(useImagePreviewCache, {
    initialProps: { ...initial, selectedNode: { path: "photo.jpg" } },
  });
  await waitFor(() =>
    expect(result.current.selectedImageSrc).toBe("/fallback.jpg"),
  );
  expect(await result.current.loadImagePreview("photo.jpg", "balanced")).toBe(
    "blob:preview",
  );
  act(() => result.current.resetSelectedImageSrc());
  expect(result.current.selectedImageSrc).toBe("");
});

it("releases the previous session and resets selection for non-images", async () => {
  const { result, rerender } = renderHook(useImagePreviewCache, {
    initialProps: { ...initial, selectedNode: { path: "photo.jpg" } },
  });
  await waitFor(() =>
    expect(result.current.selectedImageSrc).toBe("blob:preview"),
  );
  rerender({
    ...initial,
    sessionId: "session-b",
    selectedKind: "text",
    selectedNode: { path: "readme.txt" },
  });
  expect(result.current.selectedImageSrc).toBe("");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
});

it("skips requests without a session or path", async () => {
  const { result, rerender } = renderHook(useImagePreviewCache, {
    initialProps: initial,
  });
  expect(await result.current.loadImagePreview("", "balanced")).toBe("");
  rerender({ ...initial, sessionId: "" });
  expect(await result.current.loadImagePreview("photo.jpg", "balanced")).toBe(
    "",
  );
  expect(fetch).not.toHaveBeenCalled();
});
