import React, { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { VideoPreviewProps } from "../../features/workspace/types";
import { VideoPreviewContent } from "./VideoPreviewContent";
import { VideoScrubber } from "./VideoScrubber";

describe("VideoPreviewContent", () => {
  it("uses accessible native playback controls", () => {
    render(
      <VideoPreviewContent
        activeJob={null}
        onOpenDownloads={vi.fn()}
        hlsRef={createRef()}
        sessionId="session-1"
        videoHlsStatus={null}
        videoPlaybackStatus="ready"
        retryVideoPlayback={vi.fn()}
        formatBytes={(value) => `${value} bytes`}
        formatDate={(value) => String(value)}
        keyboardSettings={{ jumpSeconds: 5, rateStep: 0.25 }}
        selectedNode={{
          extension: "mp4",
          name: "sample.mp4",
          path: "sample.mp4",
          size: 1024,
          type: "file",
        }}
        selectedVideoQuality="auto"
        setSelectedVideoQuality={vi.fn()}
        videoPlaybackError=""
        videoHeight={720}
        videoQualityOptions={[]}
        videoRef={createRef<HTMLVideoElement>()}
        videoShellRef={createRef<HTMLDivElement>()}
      />,
    );

    const video = screen.getByLabelText("Video preview");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(screen.getByText("Auto · 720p playback")).toBeInTheDocument();
    expect(
      screen.queryByRole("slider", { name: "Seek video" }),
    ).not.toBeInTheDocument();
  });

  it("previews a thumbnail without seeking until the value is committed", () => {
    const videoRef = createRef<HTMLVideoElement>();
    render(
      <VideoPreviewContent
        activeJob={null}
        onOpenDownloads={vi.fn()}
        hlsRef={createRef()}
        sessionId="session/one"
        videoHlsStatus={null}
        videoPlaybackStatus="ready"
        retryVideoPlayback={vi.fn()}
        formatBytes={String}
        formatDate={String}
        keyboardSettings={{ jumpSeconds: 5, rateStep: 0.25 }}
        selectedNode={{
          extension: "mp4",
          name: "sample.mp4",
          path: "folder/sample clip.mp4",
          type: "file",
        }}
        selectedVideoQuality="720p"
        setSelectedVideoQuality={vi.fn()}
        videoPlaybackError=""
        videoHeight={720}
        videoQualityOptions={[]}
        videoRef={videoRef}
        videoShellRef={createRef<HTMLDivElement>()}
      />,
    );

    const video = screen.getByLabelText<HTMLVideoElement>("Video preview");
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 120,
    });
    video.currentTime = 12;
    fireEvent.loadedMetadata(video);

    const timeline = screen.getByRole("slider", { name: "Seek video" });
    expect(timeline).toHaveAttribute("max", "120");
    fireEvent.input(timeline, { target: { value: "60" } });

    expect(video.currentTime).toBe(12);
    expect(
      screen.getByRole("img", { name: "Preview at 1:00" }),
    ).toHaveAttribute(
      "src",
      "/api/sessions/session%2Fone/video/thumbnail?path=folder%2Fsample+clip.mp4&time=60&quality=720p&width=320",
    );
    expect(timeline).toHaveAttribute("aria-valuetext", "1:00 of 2:00");

    fireEvent.pointerUp(timeline);
    expect(video.currentTime).toBe(60);

    fireEvent.input(timeline, { target: { value: "60.25" } });
    expect(video.currentTime).toBe(60);
    fireEvent.keyUp(timeline, { key: "ArrowRight" });
    expect(video.currentTime).toBe(60.25);
  });

  it("shows distinct waiting states with recovery actions", () => {
    const setQuality = vi.fn();
    const openDownloads = vi.fn();
    const retry = vi.fn();
    const props: VideoPreviewProps = {
      activeJob: null,
      formatBytes: String,
      formatDate: String,
      hlsRef: createRef(),
      keyboardSettings: { jumpSeconds: 5, rateStep: 0.25 },
      onOpenDownloads: openDownloads,
      retryVideoPlayback: retry,
      selectedNode: { name: "clip.mp4", path: "clip.mp4", type: "file" },
      selectedVideoQuality: "720p",
      sessionId: "session-1",
      setSelectedVideoQuality: setQuality,
      videoHeight: null,
      videoHlsStatus: {
        status: "queued",
        renditions: [{ quality: "720p", status: "queued" }],
      },
      videoPlaybackError: "",
      videoPlaybackStatus: "loading",
      videoQualityOptions: [{ id: "auto", label: "Auto" }],
      videoRef: createRef(),
      videoShellRef: createRef(),
    };
    const { rerender } = render(<VideoPreviewContent {...props} />);
    expect(screen.getByText("Waiting for video encoder")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try Original" }));
    expect(setQuality).toHaveBeenCalledWith("source");

    rerender(
      <VideoPreviewContent
        {...props}
        videoHlsStatus={{
          status: "running",
          renditions: [{ quality: "720p", status: "running" }],
        }}
      />,
    );
    expect(screen.getByText("Preparing video")).toBeInTheDocument();

    rerender(
      <VideoPreviewContent
        {...props}
        activeJob={{
          sessionId: "session-1",
          sourceKind: "torrent",
          status: "downloading",
          peerCount: 0,
        }}
      />,
    );
    expect(screen.getByText("Waiting for peers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open downloads" }));
    expect(openDownloads).toHaveBeenCalledOnce();

    rerender(
      <VideoPreviewContent
        {...props}
        videoPlaybackError="Video segment is missing."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Video segment is missing.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry playback" }));
    expect(retry).toHaveBeenCalledOnce();

    rerender(
      <VideoPreviewContent
        {...props}
        selectedVideoQuality="source"
        videoPlaybackError="This browser cannot play Original."
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Try adaptive playback" }),
    );
    expect(setQuality).toHaveBeenCalledWith("auto");
  });
});

describe("video scrub preview requests", () => {
  function renderScrubber(duration: number) {
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { value: duration });
    render(
      <VideoScrubber
        path="clip.mp4"
        quality="source"
        sessionId="session"
        videoRef={{ current: video }}
      />,
    );
    return {
      video,
      timeline: screen.getByRole("slider", { name: "Seek video" }),
    };
  }

  it("does not load thumbnails during ordinary playback or after committing", () => {
    const { video, timeline } = renderScrubber(120);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    video.currentTime = 12;
    fireEvent.timeUpdate(video);
    expect(timeline).toHaveValue("12");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.input(timeline, { target: { value: "60" } });
    expect(screen.getByRole("img")).toBeInTheDocument();
    fireEvent.pointerUp(timeline);
    expect(video.currentTime).toBe(60);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it.each(["pointerCancel", "blur"] as const)(
    "cancels an unfinished seek on %s",
    (event) => {
      const { video, timeline } = renderScrubber(120);
      video.currentTime = 12;
      fireEvent.timeUpdate(video);
      fireEvent.input(timeline, { target: { value: "60" } });
      fireEvent[event](timeline);
      expect(video.currentTime).toBe(12);
      expect(timeline).toHaveValue("12");
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      fireEvent.pointerUp(timeline);
      expect(video.currentTime).toBe(12);
    },
  );

  it("does not seek on release without a preview change", () => {
    const { video, timeline } = renderScrubber(120);
    video.currentTime = 12;
    fireEvent.pointerUp(timeline);
    expect(video.currentTime).toBe(12);
  });

  it.each([
    [8, "7.5", "5"],
    [10, "10", "5"],
    [2, "2", "0"],
  ])(
    "keeps the thumbnail before the end of a %s second video",
    (duration, position, expectedThumbnailTime) => {
      const { video, timeline } = renderScrubber(duration);
      fireEvent.input(timeline, { target: { value: position } });
      const image = screen.getByRole<HTMLImageElement>("img");
      expect(new URL(image.src).searchParams.get("time")).toBe(
        expectedThumbnailTime,
      );
      expect(video.currentTime).toBe(0);
      fireEvent.keyUp(timeline, { key: "End" });
      expect(video.currentTime).toBe(Number(position));
    },
  );
});

it("loads the storyboard only on interaction and changes crops without seeking or refetching", async () => {
  const fetchIndex = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        intervalSeconds: 5,
        width: 320,
        height: 180,
        columns: 5,
        rows: 5,
        frames: [
          { time: 0, sheet: 0, x: 0, y: 0 },
          { time: 5, sheet: 0, x: 320, y: 0 },
        ],
      }),
  });
  vi.stubGlobal("fetch", fetchIndex);
  try {
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { value: 8 });
    render(
      <VideoScrubber
        path="clip.mp4"
        quality="source"
        sessionId="session"
        videoRef={{ current: video }}
      />,
    );
    expect(fetchIndex).not.toHaveBeenCalled();
    const slider = screen.getByRole("slider", { name: "Seek video" });
    fireEvent.input(slider, { target: { value: "1" } });
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        "/api/sessions/session/video/storyboard/sheet?path=clip.mp4&sheet=0",
      ),
    );
    expect(screen.getByRole("img")).toHaveStyle({
      transform: "translate(0%, 0%)",
    });
    fireEvent.input(slider, { target: { value: "7" } });
    expect(screen.getByRole("img")).toHaveStyle({
      transform: "translate(-20%, 0%)",
    });
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(0);
    fireEvent.pointerUp(slider);
    expect(video.currentTime).toBe(7);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("holds one fallback thumbnail while the cold storyboard is pending", () => {
  const fetchIndex = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetchIndex);
  try {
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { value: 120 });
    render(
      <VideoScrubber
        path="clip.mp4"
        quality="source"
        sessionId="session"
        videoRef={{ current: video }}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Seek video" });
    fireEvent.input(slider, { target: { value: "5" } });
    const first = screen.getByRole("img").getAttribute("src");
    for (const value of [10, 30, 60, 90])
      fireEvent.input(slider, { target: { value: String(value) } });
    expect(
      screen.getByRole("img", { name: "Preview at 1:30" }),
    ).toHaveAttribute("src", first);
    expect(video.currentTime).toBe(0);
    expect(fetchIndex).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not request a new source storyboard until that source is scrubbed", async () => {
  const fetchIndex = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fetchIndex);
  try {
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { value: 120 });
    const videoRef = { current: video };
    const { rerender } = render(
      <VideoScrubber
        path="first.mp4"
        quality="source"
        sessionId="session"
        videoRef={videoRef}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Seek video" });
    fireEvent.input(slider, { target: { value: "5" } });
    await waitFor(() => expect(fetchIndex).toHaveBeenCalledTimes(1));
    fireEvent.pointerUp(slider);
    rerender(
      <VideoScrubber
        path="second.mp4"
        quality="source"
        sessionId="session"
        videoRef={videoRef}
      />,
    );
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    fireEvent.input(screen.getByRole("slider", { name: "Seek video" }), {
      target: { value: "10" },
    });
    await waitFor(() => expect(fetchIndex).toHaveBeenCalledTimes(2));
  } finally {
    vi.unstubAllGlobals();
  }
});
