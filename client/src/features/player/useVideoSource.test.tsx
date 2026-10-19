import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vite-plus/test";
import { useVideoSource } from "./useVideoSource";

const instances: FakeHls[] = [];
class FakeHls {
  static DefaultConfig = { playlistLoadPolicy: undefined };
  static Events = {
    ERROR: "error",
    MANIFEST_PARSED: "manifestParsed",
    LEVEL_SWITCHED: "levelSwitched",
    AUDIO_TRACKS_UPDATED: "audioTracksUpdated",
    AUDIO_TRACK_SWITCHED: "audioTrackSwitched",
  };
  static ErrorTypes = { MEDIA_ERROR: "mediaError" };
  static supported = true;
  static isSupported() {
    return this.supported;
  }
  levels = [{ height: 360 }, { height: 720 }];
  loadLevel = -1;
  audioTracks = [
    { name: "English", lang: "eng" },
    { name: "Spanish", lang: "spa" },
  ];
  audioTrack = 0;
  destroyed = false;
  handlers = new Map<string, (event: string, data: unknown) => void>();
  constructor() {
    instances.push(this);
  }
  on(event: string, handler: (event: string, data: unknown) => void) {
    this.handlers.set(event, handler);
  }
  loadSource(_url: string) {}
  attachMedia(_video: HTMLVideoElement) {}
  destroy() {
    this.destroyed = true;
  }
  emit(event: string, data: unknown = { level: 0 }) {
    this.handlers.get(event)?.(event, data);
  }
}

vi.mock("./adaptiveQuality", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./adaptiveQuality")>()),
  loadHlsModule: () => Promise.resolve({ default: FakeHls }),
}));

function Harness({
  quality,
  file,
  active = true,
  ready = true,
}: {
  quality: string;
  file: string;
  active?: boolean;
  ready?: boolean;
}) {
  const hlsRef = useRef<InstanceType<typeof import("hls.js").default> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [, setStatus] = useState<"loading" | "buffering" | "ready">("loading");
  const [, setHeight] = useState<number | null>(null);
  const audio = useVideoSource({
    extension: "mp4",
    hlsRef,
    hlsUrl: `/hls/master?path=${file}`,
    originalUrl: `/play?path=${file}`,
    selectedKind: active && ready ? "video" : "",
    selectedQuality: quality,
    setPlaybackError: setError,
    setPlaybackStatus: setStatus,
    setVideoHeight: setHeight,
    videoRef,
  });
  return (
    <>
      {active && <video ref={videoRef} />}
      <output>{error}</output>
      {audio.videoAudioTracks.length ? (
        <select
          aria-label="Audio language"
          value={audio.selectedVideoAudioTrack}
          onChange={(event) => audio.setSelectedVideoAudioTrack(event.target.value)}
        >
          {audio.videoAudioTracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.label}
            </option>
          ))}
        </select>
      ) : null}
    </>
  );
}

describe("video quality switching", () => {
  it("detaches and pauses the previous file while qualities are pending", () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    try {
      const { container, rerender } = render(<Harness quality="source" file="one.mp4" />);
      const video = container.querySelector("video");
      if (!video) throw new Error("Video element was not rendered.");
      video.setAttribute("src", "blob:old-video");
      load.mockClear();
      rerender(<Harness quality="source" file="two.mp4" ready={false} />);
      expect(container.querySelector("video")).toBe(video);
      expect(pause).toHaveBeenCalled();
      expect(video.hasAttribute("src")).toBe(false);
      expect(video.querySelector("source")).toBeNull();
      expect(load).toHaveBeenCalled();
      rerender(<Harness quality="source" file="two.mp4" />);
      expect(video.querySelector("source")?.getAttribute("src")).toBe("/play?path=two.mp4");
    } finally {
      load.mockRestore();
      pause.mockRestore();
    }
  });
  it("attaches remux as byte-range MP4, preserves position, and explicitly switches to transcode", async () => {
    instances.length = 0;
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    try {
      const { container, rerender } = render(<Harness quality="remux" file="one.mkv" />);
      const video = container.querySelector("video");
      if (!video) throw new Error("Video element was not rendered.");
      expect(video.querySelector("source")?.getAttribute("src")).toBe(
        "/play?path=one.mkv&quality=remux",
      );
      expect(video.querySelector("source")?.type).toBe("video/mp4");
      expect(instances).toHaveLength(0);
      video.currentTime = 12;
      rerender(<Harness quality="auto" file="one.mkv" />);
      await waitFor(() => expect(instances).toHaveLength(1));
      act(() => instances[0].emit(FakeHls.Events.MANIFEST_PARSED));
      expect(video.currentTime).toBe(12);
      expect(video.querySelector("source")).toBeNull();
    } finally {
      load.mockRestore();
    }
  });
  it("reattaches the source after leaving and reopening the player view", async () => {
    instances.length = 0;
    const { rerender, container } = render(<Harness quality="auto" file="one.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const originalPlayer = container.querySelector("video");
    rerender(<Harness quality="auto" file="one.mp4" active={false} />);
    expect(instances[0].destroyed).toBe(true);
    expect(container.querySelector("video")).toBeNull();
    rerender(<Harness quality="auto" file="one.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(2));
    expect(container.querySelector("video")).not.toBe(originalPlayer);
    expect(instances[1].destroyed).toBe(false);
  });

  it("changes HLS level without replacing the player or resetting position", async () => {
    instances.length = 0;
    const { rerender, container } = render(<Harness quality="auto" file="one.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const player = container.querySelector("video");
    if (!player) throw new Error("Video element was not rendered.");
    act(() => instances[0].emit(FakeHls.Events.MANIFEST_PARSED));
    player.currentTime = 12;
    rerender(<Harness quality="720p" file="one.mp4" />);
    expect(instances).toHaveLength(1);
    expect(instances[0].loadLevel).toBe(1);
    expect(player.currentTime).toBe(12);
    expect(instances[0].destroyed).toBe(false);

    rerender(<Harness quality="auto" file="one.mp4" />);
    expect(instances[0].loadLevel).toBe(-1);
    expect(instances).toHaveLength(1);

    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    rerender(<Harness quality="source" file="one.mp4" />);
    expect(instances[0].destroyed).toBe(true);
    expect(player.querySelector("source")?.getAttribute("src")).toBe("/play?path=one.mp4");
    load.mockRestore();

    player.currentTime = 0;
    rerender(<Harness quality="720p" file="two.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(2));
    act(() => instances[1].emit(FakeHls.Events.MANIFEST_PARSED));
    expect(player.currentTime).toBe(0);
  });

  it("identifies a missing HLS segment from a fragment 404", async () => {
    instances.length = 0;
    const { container } = render(<Harness quality="auto" file="one.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(1));
    act(() =>
      instances[0].emit(FakeHls.Events.ERROR, {
        fatal: true,
        type: "networkError",
        details: "fragLoadError",
        response: { code: 404 },
      }),
    );
    expect(container.querySelector("output")?.textContent).toBe("Video segment is missing.");
  });
});

it("switches real HLS audio without recreating playback or dropping captions and follows HLS events", async () => {
  instances.length = 0;
  const { container } = render(<Harness quality="auto" file="languages.mkv" />);
  await waitFor(() => expect(instances).toHaveLength(1));
  const video = container.querySelector("video");
  if (!video) throw new Error("Video missing.");
  act(() => instances[0].emit(FakeHls.Events.AUDIO_TRACKS_UPDATED));
  const picker = screen.getByLabelText("Audio language");
  expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
  video.currentTime = 12;
  const captions = document.createElement("track");
  video.appendChild(captions);
  const paused = video.paused;
  fireEvent.change(picker, { target: { value: "1" } });
  expect(instances[0].audioTrack).toBe(1);
  expect(instances).toHaveLength(1);
  expect(instances[0].destroyed).toBe(false);
  expect(video.currentTime).toBe(12);
  expect(video.paused).toBe(paused);
  expect(video.contains(captions)).toBe(true);
  act(() => instances[0].emit(FakeHls.Events.AUDIO_TRACK_SWITCHED, { id: 1 }));
  expect(picker).toHaveValue("1");
  instances[0].audioTrack = 0;
  act(() => instances[0].emit(FakeHls.Events.AUDIO_TRACK_SWITCHED, { id: 0 }));
  expect(picker).toHaveValue("0");
});

it("uses native audio tracks for Safari HLS and follows browser selections without resetting the video", async () => {
  const tracks = Object.assign(new EventTarget(), {
    length: 2,
    0: { label: "English", language: "eng", enabled: true },
    1: { label: "Spanish", language: "spa", enabled: false },
  });
  const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "audioTracks");
  Object.defineProperty(HTMLMediaElement.prototype, "audioTracks", {
    configurable: true,
    get: () => tracks,
  });
  const remove = vi.spyOn(tracks, "removeEventListener");
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const canPlay = vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
  FakeHls.supported = false;
  try {
    const { container, unmount } = render(<Harness quality="auto" file="native.mkv" />);
    const video = container.querySelector("video");
    if (!video) throw new Error("Video missing.");
    await waitFor(() => expect(video).toHaveAttribute("src", "/hls/master?path=native.mkv"));
    const picker = screen.getByLabelText("Audio language");
    expect(picker).toHaveValue("0");
    video.currentTime = 12;
    fireEvent.change(picker, { target: { value: "1" } });
    expect(tracks[0].enabled).toBe(false);
    expect(tracks[1].enabled).toBe(true);
    expect(video.currentTime).toBe(12);
    expect(picker).toHaveValue("1");
    act(() => {
      tracks[0].enabled = true;
      tracks[1].enabled = false;
      tracks.dispatchEvent(new Event("change"));
    });
    expect(picker).toHaveValue("0");
    unmount();
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
  } finally {
    FakeHls.supported = true;
    load.mockRestore();
    pause.mockRestore();
    canPlay.mockRestore();
    if (original) Object.defineProperty(HTMLMediaElement.prototype, "audioTracks", original);
    else Reflect.deleteProperty(HTMLMediaElement.prototype, "audioTracks");
  }
});

it("preserves subtitle tracks when switching between Original and adaptive playback", async () => {
  instances.length = 0;
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  try {
    const { container, rerender } = render(<Harness quality="auto" file="one.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(1));
    const video = container.querySelector("video");
    if (!video) throw new Error("Video element missing.");
    const track = document.createElement("track");
    video.appendChild(track);
    rerender(<Harness quality="source" file="one.mp4" />);
    expect(video.contains(track)).toBe(true);
    rerender(<Harness quality="auto" file="one.mp4" />);
    await waitFor(() => expect(instances).toHaveLength(2));
    expect(video.contains(track)).toBe(true);
    expect(video.querySelector("source")).toBeNull();
  } finally {
    load.mockRestore();
  }
});
