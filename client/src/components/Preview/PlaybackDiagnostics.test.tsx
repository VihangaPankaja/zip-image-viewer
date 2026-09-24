import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type Hls from "hls.js";
import { expect, it, vi } from "vitest";
import { PlaybackDiagnostics } from "./PlaybackDiagnostics";

it("shows playback measurements and copies a report without media paths", async () => {
  const videoRef = createRef<HTMLVideoElement>();
  const hlsRef = {
    current: {
      bandwidthEstimate: 2_500_000,
      currentLevel: 0,
      levels: [{ height: 720 }],
    } as Hls,
  };
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(
    <PlaybackDiagnostics
      hlsRef={hlsRef}
      videoRef={videoRef}
      selectedVideoQuality="auto"
      videoHeight={720}
      videoPlaybackError="https://example.test/private/video.mp4"
      videoHlsStatus={{
        status: "running",
        renditions: [{ quality: "720p", status: "running", encoderWaitMs: 42 }],
      }}
    />,
  );
  const details = screen.getByText("Playback diagnostics").closest("details");
  if (!details) throw new Error("Diagnostics details missing");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(screen.getByText("42 ms")).toBeInTheDocument());
  expect(screen.getByText("2.5 Mbps")).toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Copy diagnostic report" }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).not.toContain("example.test");
  expect(writeText.mock.calls[0][0]).toContain('"encoderWaitMs": 42');
});
