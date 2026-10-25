import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vite-plus/test";
import { VideoPlayerControls } from "../../../../../client/src/components/Preview/VideoPlayerControls";

function setup() {
  const videoRef = createRef<HTMLVideoElement>();
  const videoShellRef = createRef<HTMLDivElement>();
  const fallback = vi.fn();
  render(
    <div ref={videoShellRef}>
      <video ref={videoRef} aria-label="Test video" />
      <VideoPlayerControls
        videoRef={videoRef}
        videoShellRef={videoShellRef}
        onFallback={fallback}
      />
    </div>,
  );
  const video = screen.getByLabelText<HTMLVideoElement>("Test video");
  const shell = videoShellRef.current;
  if (!shell) throw new Error("Player shell missing");
  return { video, shell, fallback };
}

it("controls actual playback, mute and volume and follows media events", async () => {
  const { video } = setup();
  const play = vi.spyOn(video, "play").mockResolvedValue();
  const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
  expect(play).toHaveBeenCalledOnce();
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  fireEvent.play(video);
  fireEvent.click(screen.getByRole("button", { name: "Pause video" }));
  expect(pause).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Mute video" }));
  expect(video.muted).toBe(true);
  await waitFor(() => expect(screen.getByRole("button", { name: "Unmute video" })).toBeVisible());
  fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0.4" } });
  expect(video.volume).toBe(0.4);
  expect(video.muted).toBe(false);
});

it("offers native recovery after a rejected play request", async () => {
  const { video, fallback } = setup();
  vi.spyOn(video, "play").mockRejectedValue(new Error("Playback blocked"));
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
  await waitFor(() => expect(fallback).toHaveBeenCalledOnce());
});

it.each(["AbortError", "NotAllowedError"])(
  "ignores an obsolete %s after the media source changes",
  async (name) => {
    const { video, fallback } = setup();
    vi.spyOn(video, "play").mockRejectedValue(new DOMException("Old request failed", name));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Play video" }));
      Object.defineProperty(video, "currentSrc", { value: "https://example.test/new.mp4" });
      await Promise.resolve();
    });
    expect(fallback).not.toHaveBeenCalled();
  },
);

it("keeps custom controls when playback is deliberately interrupted", async () => {
  const { video, fallback } = setup();
  vi.spyOn(video, "play").mockRejectedValue(new DOMException("Interrupted", "AbortError"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    await Promise.resolve();
  });
  expect(fallback).not.toHaveBeenCalled();
});

it("fullscreens the shell so the timeline stays available", () => {
  const { shell } = setup();
  const fullscreen = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(shell, "requestFullscreen", { value: fullscreen });
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  expect(fullscreen).toHaveBeenCalledOnce();
});

it("shows Exit when the surrounding preview is already fullscreen", () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: document.body,
  });
  try {
    setup();
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
  } finally {
    if (descriptor) Object.defineProperty(document, "fullscreenElement", descriptor);
    else Reflect.deleteProperty(document, "fullscreenElement");
  }
});

it("hands iOS fullscreen to native controls and restores controls on exit", () => {
  const { video } = setup();
  const enter = vi.fn();
  Object.defineProperty(video, "webkitEnterFullscreen", { value: enter });
  fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
  expect(enter).toHaveBeenCalledOnce();
  expect(video.controls).toBe(true);
  fireEvent(video, new Event("webkitendfullscreen"));
  expect(video.controls).toBe(false);
});
