import React, { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { VideoPreviewContent } from "./VideoPreviewContent";

describe("VideoPreviewContent", () => {
  it("uses accessible native playback controls", () => {
    render(
      <VideoPreviewContent
        activeJob={null}
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
        videoQualityOptions={[]}
        videoRef={createRef<HTMLVideoElement>()}
        videoShellRef={createRef<HTMLDivElement>()}
      />,
    );

    const video = screen.getByLabelText("Video preview");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(
      screen.queryByRole("slider", { name: "Seek video" }),
    ).not.toBeInTheDocument();
  });
});
