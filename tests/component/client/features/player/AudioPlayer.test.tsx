import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vite-plus/test";
import { AudioPlayerProvider } from "../../../../../client/src/features/player/AudioPlayerProvider";
import { AudioPlayerControls } from "../../../../../client/src/features/player/AudioPlayerControls";
import type { PreviewNode } from "../../../../../client/src/features/workspace/types";

const files: PreviewNode[] = [
  { type: "file", name: "First.wav", path: "Album/First.wav", extension: "wav" },
  { type: "file", name: "Second.wav", path: "Album/Second.wav", extension: "wav" },
  { type: "file", name: "cover.png", path: "Album/cover.png", extension: "png" },
];

function setup(tracks: readonly PreviewNode[] = files) {
  let paused = true;
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
  const onSelect = vi.fn();
  const view = (selectedPath = files[0].path, visible = true, sessionId = "session") => (
    <AudioPlayerProvider
      sessionId={sessionId}
      files={tracks}
      selectedPath={selectedPath}
      visible={visible}
      onSelect={onSelect}
      onReveal={vi.fn()}
    >
      {visible ? <AudioPlayerControls /> : <p>Downloads</p>}
    </AudioPlayerProvider>
  );
  const result = render(view());
  const audio = screen.getByLabelText<HTMLAudioElement>("Audio playback");
  return { ...result, audio, play, pause, view, onSelect };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("opens silently with unknown duration and a single disabled timeline", () => {
  const { play, audio } = setup();
  expect(play).not.toHaveBeenCalled();
  expect(audio).not.toHaveAttribute("autoplay");
  expect(screen.getByRole("slider", { name: "Audio position" })).toBeDisabled();
  expect(screen.getByText("Duration unknown")).toBeVisible();
  expect(screen.getByRole("img", { name: "Album artwork" })).toHaveAttribute(
    "src",
    expect.stringContaining("cover.png"),
  );
});

it("seeks within known duration and controls volume and speed", () => {
  const { audio } = setup();
  Object.defineProperty(audio, "duration", { configurable: true, value: 120 });
  fireEvent.loadedMetadata(audio);
  fireEvent.change(screen.getByRole("slider", { name: "Audio position" }), {
    target: { value: "30" },
  });
  expect(audio.currentTime).toBe(30);
  fireEvent.click(screen.getByRole("button", { name: "+10s, Forward 10 seconds" }));
  expect(audio.currentTime).toBe(40);
  fireEvent.click(screen.getByRole("button", { name: "−10s, Back 10 seconds" }));
  expect(audio.currentTime).toBe(30);
  fireEvent.change(screen.getByRole("slider", { name: "Audio volume" }), {
    target: { value: "0.4" },
  });
  expect(audio.volume).toBe(0.4);
  fireEvent.change(screen.getByRole("combobox", { name: "Speed" }), {
    target: { value: "1.5" },
  });
  expect(audio.playbackRate).toBe(1.5);
});

it("keeps playback and queue choices when controls move to the persistent player", async () => {
  const { audio, play, rerender, view, onSelect } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Repeat" }), {
    target: { value: "all" },
  });
  rerender(view("notes.txt", false));
  expect(screen.getByLabelText("Audio playback")).toBe(audio);
  expect(screen.getByRole("button", { name: "Pause audio" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next track" }));
  expect(onSelect).not.toHaveBeenCalled();
  await waitFor(() => expect(audio.src).toContain("Second.wav"));
  expect(play).toHaveBeenCalledTimes(2);
  rerender(view(files[1].path));
  expect(screen.getByRole("combobox", { name: "Repeat" })).toHaveValue("all");
});

it("does not auto-advance past the queue and repeats only when requested", async () => {
  const { audio, play } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Next track" }));
  expect(play).not.toHaveBeenCalled();
  fireEvent.ended(audio);
  expect(play).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "Repeat" }), {
    target: { value: "one" },
  });
  fireEvent.ended(audio);
  await waitFor(() => expect(play).toHaveBeenCalledOnce());
  expect(audio.currentTime).toBe(0);
});

it("removes a queued track without restoring it on ordinary rerenders", () => {
  const { rerender, view } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Remove Second.wav from queue" }));
  rerender(view());
  expect(screen.queryByRole("button", { name: "Queue Second.wav" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
});

it("replaces the custom timeline with native controls and keeps recovery available", async () => {
  const { audio, play } = setup();
  play.mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
    await Promise.resolve();
  });
  expect(screen.getByRole("alert")).toHaveTextContent("browser controls");
  fireEvent.click(screen.getByRole("checkbox", { name: "Use browser audio controls" }));
  expect(audio.controls).toBe(true);
  expect(screen.queryByRole("slider", { name: "Audio position" })).not.toBeInTheDocument();
  fireEvent.error(audio);
  expect(screen.getByRole("link", { name: "Download original audio" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry audio" })).toBeVisible();
});

it("stops and releases the media source when the session closes", () => {
  const { audio, pause, rerender, view } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
  rerender(view("", false, ""));
  expect(pause).toHaveBeenCalled();
  expect(audio).not.toHaveAttribute("src");
  expect(screen.queryByRole("button", { name: "Pause audio" })).not.toBeInTheDocument();
});

it("recovers from an empty queue without reopening the session", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Remove Second.wav from queue" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove First.wav from queue" }));
  expect(screen.getByText("Queue empty")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load session audio" }));
  expect(screen.getByRole("button", { name: "Play audio" })).toBeVisible();
});

it("ignores a rejected play request after retrying the same source", async () => {
  const { audio, play } = setup();
  let rejectPlay: (reason: Error) => void = () => undefined;
  play.mockReturnValueOnce(
    new Promise<void>((_resolve, reject) => {
      rejectPlay = reject;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
  fireEvent.error(audio);
  fireEvent.click(screen.getByRole("button", { name: "Retry audio" }));
  await act(async () => {
    rejectPlay(new Error("Old request failed"));
    await Promise.resolve();
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("advances audio without replacing an unrelated image preview", () => {
  const { audio, rerender, view, onSelect } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
  rerender(view("image.png", false));
  fireEvent.ended(audio);
  expect(audio.src).toContain("Second.wav");
  expect(onSelect).not.toHaveBeenCalled();
});

it("keeps OS play/pause/seek actions after pausing and releases them for video", () => {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  const session = {
    metadata: null,
    playbackState: "none",
    setPositionState: vi.fn(),
    setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) =>
      handlers.set(action, handler),
  };
  vi.stubGlobal("navigator", { mediaSession: session });
  const { audio, play } = setup();
  Object.defineProperty(audio, "duration", { configurable: true, value: 120 });
  fireEvent.loadedMetadata(audio);
  fireEvent.click(screen.getByRole("button", { name: "Play audio" }));
  expect(session.playbackState).toBe("playing");
  act(() => handlers.get("pause")?.({ action: "pause" }));
  expect(session.playbackState).toBe("paused");
  act(() => handlers.get("play")?.({ action: "play" }));
  expect(play).toHaveBeenCalledTimes(2);
  act(() => handlers.get("seekto")?.({ action: "seekto", seekTime: 30 }));
  expect(audio.currentTime).toBe(30);
  const video = document.createElement("video");
  document.body.append(video);
  fireEvent.play(video);
  expect(audio.paused).toBe(true);
  expect(handlers.get("play")).toBeNull();
  video.remove();
});

it("exits preview fullscreen before showing the persistent native player", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: document.body,
  });
  let finishExit: () => void = () => undefined;
  const exit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishExit = resolve;
      }),
  );
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
  try {
    const { audio } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use browser audio controls" }));
    expect(exit).toHaveBeenCalledOnce();
    expect(audio.controls).toBe(true);
  } finally {
    await act(async () => {
      finishExit();
      await Promise.resolve();
    });
    if (descriptor) Object.defineProperty(document, "fullscreenElement", descriptor);
    else Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
  }
});

it("keeps custom controls when fullscreen exit fails", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: document.body,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: vi.fn().mockRejectedValue(new Error("Exit failed")),
  });
  try {
    const { audio } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use browser audio controls" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Exit fullscreen"));
    expect(audio.controls).toBe(false);
    expect(screen.getByRole("slider", { name: "Audio position" })).toBeVisible();
  } finally {
    if (descriptor) Object.defineProperty(document, "fullscreenElement", descriptor);
    else Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
  }
});

it("applies the active shuffle choice when restoring an empty queue", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  setup([...files, { type: "file", name: "Third.wav", path: "Album/Third.wav", extension: "wav" }]);
  fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
  for (const name of ["Third.wav", "Second.wav", "First.wav"]) {
    fireEvent.click(screen.getByRole("button", { name: `Remove ${name} from queue` }));
  }
  fireEvent.click(screen.getByRole("button", { name: "Load session audio" }));
  expect(
    screen.getAllByRole("button", { name: /^Queue / }).map((button) => button.textContent),
  ).toEqual(["First.wav", "Third.wav", "Second.wav"]);
});
