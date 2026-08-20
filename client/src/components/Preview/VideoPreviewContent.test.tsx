import React, { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { VideoPreviewContent } from "./VideoPreviewContent";

describe("VideoPreviewContent", () => {
  it("exposes the seek control by its purpose", () => {
    render(
      <VideoPreviewContent
        activeJob={null}
        formatBytes={(value) => `${value} bytes`}
        formatDate={(value) => String(value)}
        keyboardSettings={{ jumpSeconds: 5, rateStep: 0.25 }}
        seekVideoTo={vi.fn()}
        selectedNode={{
          extension: "mp4",
          name: "sample.mp4",
          path: "sample.mp4",
          size: 1024,
          type: "file",
        }}
        selectedVideoQuality="auto"
        setSelectedVideoQuality={vi.fn()}
        setVideoPlaybackRate={vi.fn()}
        setVideoSeekHoverTime={vi.fn()}
        setVideoVolume={vi.fn()}
        toggleVideoFullscreen={vi.fn()}
        toggleVideoPlayback={vi.fn()}
        videoBufferedPercent={40}
        videoCurrentTime={10}
        videoDuration={60}
        videoIsFullscreen={false}
        videoIsPlaying={false}
        videoPlaybackError=""
        videoPlaybackRate={1}
        videoPlayedPercent={20}
        videoQualityOptions={[]}
        videoRef={createRef<HTMLVideoElement>()}
        videoSeekHoverTime={null}
        videoSeekPreviewUrl=""
        videoShellRef={createRef<HTMLDivElement>()}
        videoVolume={0.8}
      />,
    );

    expect(
      screen.getByRole("slider", { name: "Seek video" }),
    ).toBeInTheDocument();
  });
});
