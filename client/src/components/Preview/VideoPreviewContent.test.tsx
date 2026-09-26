import React, { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
