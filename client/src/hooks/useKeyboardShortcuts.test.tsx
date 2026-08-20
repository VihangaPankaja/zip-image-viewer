import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

describe("useKeyboardShortcuts", () => {
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
});
