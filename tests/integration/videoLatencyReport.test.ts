import { describe, expect, it } from "vitest";
import {
  renderVideoLatencyReport,
  summarizeVideoLatency,
  type VideoLatencySample,
} from "../benchmarks/videoLatencyReport.js";

const samples: VideoLatencySample[] = [
  {
    mode: "original",
    startupMs: 90,
    seekMs: 120,
    bufferSeconds: 4,
    transferMs: 30,
    encoderQueueMs: 0,
    encoderMs: 0,
    rendition: "source",
    cache: "n/a",
  },
  {
    mode: "original",
    startupMs: 110,
    seekMs: 150,
    bufferSeconds: 5,
    transferMs: 50,
    encoderQueueMs: 0,
    encoderMs: 0,
    rendition: "source",
    cache: "n/a",
  },
  {
    mode: "original",
    startupMs: 100,
    seekMs: 130,
    bufferSeconds: 6,
    transferMs: 40,
    encoderQueueMs: 0,
    encoderMs: 0,
    rendition: "source",
    cache: "n/a",
  },
];

describe("video latency report", () => {
  it("reports hand-checked p50 and p95 values for each playback mode", () => {
    expect(summarizeVideoLatency(samples)).toEqual([
      {
        mode: "original",
        samples: 3,
        startupP50Ms: 100,
        startupP95Ms: 110,
        seekP50Ms: 130,
        seekP95Ms: 150,
        bufferP50Seconds: 5,
        transferP95Ms: 50,
        encoderQueueP95Ms: 0,
        encoderP95Ms: 0,
        rendition: "source",
        cache: "n/a",
      },
    ]);
  });

  it("renders the environment and every measured latency source", () => {
    const report = renderVideoLatencyReport({
      generatedAt: "2026-09-06T00:00:00.000Z",
      machine: "test-machine",
      network: "loopback, unthrottled",
      clip: "24 s, 640x360 H.264/AAC fixture",
      summaries: summarizeVideoLatency(samples),
      samples,
    });

    expect(report).toContain("test-machine");
    expect(report).toContain("loopback, unthrottled");
    expect(report).toContain("| Original | 3 | 100 | 110 | 130 | 150 |");
    expect(report).toContain("Transfer p95");
    expect(report).toContain("Encoder queue p95");
    expect(report).toContain("Encoder p95");
  });
});
