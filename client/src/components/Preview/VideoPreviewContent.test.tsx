import React, { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { VideoPreviewProps } from "../../features/workspace/types";
import { VideoPreviewContent } from "./VideoPreviewContent";

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
