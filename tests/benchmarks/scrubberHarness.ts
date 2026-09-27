import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { VideoScrubber } from "../../client/src/components/Preview/VideoScrubber";
const root = document.getElementById("root");
const video = document.querySelector("video");
if (!root || !video) throw new Error("Benchmark media elements missing");
createRoot(root).render(
  createElement(VideoScrubber, {
    sessionId: "benchmark",
    path: "clip.mp4",
    quality: "source",
    videoRef: { current: video },
  }),
);
