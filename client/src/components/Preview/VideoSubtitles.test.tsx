import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { vi } from "vitest";
import { VideoSubtitles } from "./VideoSubtitles";

const vtt = "WEBVTT\n\n00:01.000 --> 00:03.000\nHello";
function upload(name: string, text = vtt, size = text.length) {
  fireEvent.change(screen.getByLabelText("Subtitle file"), {
    target: { files: [{ name, size, text: () => Promise.resolve(text) }] },
  });
}

it("rejects oversized and malformed files and recovers on a later selection", async () => {
  const video = document.createElement("video");
  render(<VideoSubtitles videoRef={{ current: video }} />);
  upload("huge.vtt", vtt, 2 * 1024 * 1024 + 1);
  expect(screen.getByRole("alert")).toHaveTextContent("2 MB");
  upload("broken.vtt", "not captions");
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("valid WebVTT"),
  );
  upload("other.txt");
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(".vtt or .srt"),
  );
  expect(video.querySelector("track")).toBeNull();
});

it("ignores late file reads after changing videos", async () => {
  const video = document.createElement("video");
  const videoRef = { current: video };
  const { rerender } = render(
    <VideoSubtitles key="first" videoRef={videoRef} />,
  );
  let finish: (value: string) => void = () => {};
  const text = new Promise<string>((resolve) => {
    finish = resolve;
  });
  fireEvent.change(screen.getByLabelText("Subtitle file"), {
    target: { files: [{ name: "slow.vtt", size: 20, text: () => text }] },
  });
  rerender(<VideoSubtitles key="second" videoRef={videoRef} />);
  await act(async () => {
    finish("malformed old file");
    await text;
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(video.querySelector("track")).toBeNull();
});

it("updates native cue times without drift and cleans up track resources", async () => {
  const cues = [{ startTime: 1, endTime: 3 }];
  const nativeTrack = {
    cues,
    mode: "disabled",
    removeCue: vi.fn(),
    addCue: vi.fn(),
  };
  const video = document.createElement("video");
  Object.defineProperty(video, "textTracks", { value: new EventTarget() });
  const original = Object.getOwnPropertyDescriptor(
    HTMLTrackElement.prototype,
    "track",
  );
  Object.defineProperty(HTMLTrackElement.prototype, "track", {
    configurable: true,
    get: () => nativeTrack,
  });
  const create = vi.fn(() => "blob:captions");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: create,
      revokeObjectURL: revoke,
    }),
  );
  try {
    const { unmount } = render(
      <VideoSubtitles videoRef={{ current: video }} />,
    );
    upload("captions.srt", "1\n00:00:01,000 --> 00:00:03,000\nHello");
    await waitFor(() => expect(video.querySelector("track")).not.toBeNull());
    const track = video.querySelector("track");
    if (!track) throw new Error("Subtitle track missing.");
    fireEvent.load(track);
    expect(screen.getByRole("button", { name: "Captions" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const offset = screen.getByLabelText("Caption offset (seconds)");
    fireEvent.change(offset, { target: { value: "2" } });
    expect(cues[0]).toEqual({ startTime: 3, endTime: 5 });
    fireEvent.change(offset, { target: { value: "-2" } });
    expect(cues[0]).toEqual({ startTime: 0, endTime: 1 });
    fireEvent.change(offset, { target: { value: "0" } });
    expect(cues[0]).toEqual({ startTime: 1, endTime: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Captions" }));
    expect(nativeTrack.mode).toBe("disabled");
    act(() => {
      nativeTrack.mode = "showing";
      video.textTracks.dispatchEvent(new Event("change"));
    });
    expect(screen.getByRole("button", { name: "Captions" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText("Caption size"), {
      target: { value: "large" },
    });
    expect(video.dataset.captionSize).toBe("large");
    upload("broken.vtt", "bad");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(video.querySelector("track")).toBe(track);
    fireEvent.click(screen.getByRole("button", { name: "Remove subtitles" }));
    expect(video.querySelector("track")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:captions");
    upload("retry.vtt");
    await waitFor(() => expect(video.querySelector("track")).not.toBeNull());
    const failedTrack = video.querySelector("track");
    if (!failedTrack) throw new Error("Subtitle track missing.");
    fireEvent.error(failedTrack);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText(/Loading subtitles/)).not.toBeInTheDocument();
    expect(video.querySelector("track")).toBeNull();
    unmount();
    expect(video.dataset.captionSize).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
    if (original)
      Object.defineProperty(HTMLTrackElement.prototype, "track", original);
    else Reflect.deleteProperty(HTMLTrackElement.prototype, "track");
  }
});
