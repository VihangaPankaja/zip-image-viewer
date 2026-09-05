import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

describe("useKeyboardShortcuts", () => {
  function renderShortcuts(
    overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {},
  ) {
    const video = document.createElement("video");
    const setSelectedPath = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({
        keyboardSettings: { jumpSeconds: 5 },
        selectedKind: "video",
        videoRef: { current: video },
        videoShellRef: { current: document.createElement("div") },
        setVideoVolume: vi.fn(),
        setVideoPlaybackRate: vi.fn(),
        currentImageIndex: 0,
        nextImagePath: "next.mp4",
        previousImagePath: "previous.mp4",
        currentFolderImages: ["current.mp4", "next.mp4"],
        slideshowOpen: false,
        setSelectedPath,
        setSlideshowOpen: vi.fn(),
        ...overrides,
      }),
    );
    return { setSelectedPath, video };
  }

  it("leaves keyboard events from native video controls alone", () => {
    const video = document.createElement("video");
    video.tabIndex = 0;
    video.currentTime = 12;
    document.body.append(video);
    video.focus();

    renderHook(() =>
      useKeyboardShortcuts({
        keyboardSettings: { jumpSeconds: 5 },
        selectedKind: "video",
        videoRef: { current: video },
        videoShellRef: { current: document.createElement("div") },
        setVideoVolume: vi.fn(),
        setVideoPlaybackRate: vi.fn(),
        currentImageIndex: -1,
        nextImagePath: "",
        previousImagePath: "",
        currentFolderImages: [],
        slideshowOpen: false,
        setSelectedPath: vi.fn(),
        setSlideshowOpen: vi.fn(),
      }),
    );

    video.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );

    expect(video.currentTime).toBe(12);
    video.remove();
  });

  it("cycles previewable video siblings with arrow keys", () => {
    const { setSelectedPath } = renderShortcuts();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

    expect(setSelectedPath).toHaveBeenCalledWith("next.mp4");
  });

  it("uses J and L to seek a maximized video", () => {
    const { video } = renderShortcuts();
    video.currentTime = 12;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.createElement("section"),
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l" }));
    expect(video.currentTime).toBe(17);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    expect(video.currentTime).toBe(12);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
  });

  it("ignores the fullscreen shortcut when the API is unavailable", () => {
    renderShortcuts();

    expect(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" })),
    ).not.toThrow();
  });
});
