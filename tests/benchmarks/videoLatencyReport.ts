export type VideoLatencyMode = "original" | "prepared-hls" | "cold-hls";

export type VideoLatencySample = {
  mode: VideoLatencyMode;
  startupMs: number;
  seekMs: number;
  bufferSeconds: number;
  transferMs: number;
  encoderQueueMs: number;
  encoderMs: number;
  rendition: string;
  cache: "hit" | "miss" | "n/a";
};

export type VideoLatencySummary = {
  mode: VideoLatencyMode;
  samples: number;
  startupP50Ms: number;
  startupP95Ms: number;
  seekP50Ms: number;
  seekP95Ms: number;
  bufferP50Seconds: number;
  transferP95Ms: number;
  encoderQueueP95Ms: number;
  encoderP95Ms: number;
  rendition: string;
  cache: VideoLatencySample["cache"];
};

function percentile(values: number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summarizeVideoLatency(
  samples: VideoLatencySample[],
): VideoLatencySummary[] {
  return [...new Set(samples.map(({ mode }) => mode))].map((mode) => {
    const group = samples.filter((sample) => sample.mode === mode);
    const metric = (key: keyof VideoLatencySample, fraction: number) =>
      rounded(
        percentile(
          group.map((sample) => Number(sample[key])),
          fraction,
        ),
      );
    return {
      mode,
      samples: group.length,
      startupP50Ms: metric("startupMs", 0.5),
      startupP95Ms: metric("startupMs", 0.95),
      seekP50Ms: metric("seekMs", 0.5),
      seekP95Ms: metric("seekMs", 0.95),
      bufferP50Seconds: metric("bufferSeconds", 0.5),
      transferP95Ms: metric("transferMs", 0.95),
      encoderQueueP95Ms: metric("encoderQueueMs", 0.95),
      encoderP95Ms: metric("encoderMs", 0.95),
      rendition: group[0].rendition,
      cache: group[0].cache,
    };
  });
}

const labels: Record<VideoLatencyMode, string> = {
  original: "Original",
  "prepared-hls": "Prepared HLS",
  "cold-hls": "Cold HLS",
};

export function renderVideoLatencyReport(input: {
  generatedAt: string;
  machine: string;
  network: string;
  clip: string;
  summaries: VideoLatencySummary[];
  samples: VideoLatencySample[];
}): string {
  const rows = input.summaries
    .map(
      (summary) =>
        `| ${labels[summary.mode]} | ${summary.samples} | ${summary.startupP50Ms} | ${summary.startupP95Ms} | ${summary.seekP50Ms} | ${summary.seekP95Ms} | ${summary.bufferP50Seconds} | ${summary.transferP95Ms} | ${summary.encoderQueueP95Ms} | ${summary.encoderP95Ms} | ${summary.rendition} | ${summary.cache} |`,
    )
    .join("\n");
  return `# Video latency baseline

- Generated: ${input.generatedAt}
- Machine: ${input.machine}
- Network: ${input.network}
- Clip: ${input.clip}

| Mode | Samples | Startup p50 (ms) | Startup p95 (ms) | Seek p50 (ms) | Seek p95 (ms) | Buffer p50 (s) | Transfer p95 (ms) | Encoder queue p95 (ms) | Encoder p95 (ms) | Rendition | Cache |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
${rows}
`;
}
