export type VideoDimensions = {
  width: number;
  height: number;
};

export type HlsRendition = VideoDimensions & {
  id: string;
  bandwidth: number;
  codecs?: string;
};

const LADDER = [
  { height: 360, videoBitrate: 800_000 },
  { height: 480, videoBitrate: 1_400_000 },
  { height: 720, videoBitrate: 2_800_000 },
  { height: 1080, videoBitrate: 5_000_000 },
  { height: 1440, videoBitrate: 8_000_000 },
  { height: 2160, videoBitrate: 14_000_000 },
] as const;

export const AUDIO_BITRATE = 128_000;

export function videoBitrateForHeight(height: number): number {
  return (
    [...LADDER].reverse().find((level) => height >= level.height)
      ?.videoBitrate ?? 800_000
  );
}

function advertisedBandwidth(height: number): number {
  return ((videoBitrateForHeight(height) + AUDIO_BITRATE) * 11) / 10;
}

export function codecsFromInit(init: Buffer): string | undefined {
  const box = init.indexOf("avcC");
  if (box < 0 || box + 8 > init.length) return undefined;
  const avc = `avc1.${init.subarray(box + 5, box + 8).toString("hex")}`;
  return init.includes("mp4a") ? `${avc},mp4a.40.2` : avc;
}

function evenWidth(dimensions: VideoDimensions, targetHeight: number): number {
  const ratio = dimensions.width / dimensions.height;
  return Math.max(2, Math.round((ratio * targetHeight) / 2) * 2);
}

export function calculateRenditions(
  dimensions: VideoDimensions,
): HlsRendition[] {
  if (dimensions.width <= 0 || dimensions.height <= 0) return [];

  const renditions = LADDER.filter(
    ({ height }) => height <= dimensions.height,
  ).map(({ height }) => ({
    id: `${String(height)}p`,
    width: evenWidth(dimensions, height),
    height,
    bandwidth: advertisedBandwidth(height),
  }));

  if (renditions.length > 0) return renditions;
  return [
    {
      id: "source",
      width: dimensions.width,
      height: dimensions.height,
      bandwidth: advertisedBandwidth(dimensions.height),
    },
  ];
}

export function buildMasterPlaylist(
  renditions: readonly HlsRendition[],
  getUri: (_rendition: HlsRendition) => string,
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7"];
  for (const rendition of renditions) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${String(rendition.bandwidth)},RESOLUTION=${String(rendition.width)}x${String(rendition.height)}${rendition.codecs ? `,CODECS="${rendition.codecs}"` : ""}`,
      getUri(rendition),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function publishedSegments(playlist: string): number[] {
  const lines = playlist
    .slice(0, playlist.lastIndexOf("\n") + 1)
    .split(/\r?\n/);
  const segments: number[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!/^#EXTINF:\d+(?:\.\d+)?,/.test(lines[i])) continue;
    const match = /^segment_(\d+)\.m4s$/.exec(lines[i + 1]);
    if (match) segments.push(Number(match[1]));
  }
  return segments;
}

export function buildVariantPlaylist(
  source: string,
  initUri: string,
  segmentUri: (_index: number) => string,
): string {
  const completeLines = source.slice(0, source.lastIndexOf("\n") + 1);
  const lines = completeLines.split(/\r?\n/);
  const output: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#EXTINF:/.test(line)) {
      const match = /^segment_(\d+)\.m4s$/.exec(lines[i + 1]);
      if (match && /^#EXTINF:\d+(?:\.\d+)?,/.test(line)) {
        output.push(line, segmentUri(Number(match[1])));
        i += 1;
      }
    } else if (line === '#EXT-X-MAP:URI="init.mp4"') {
      output.push(`#EXT-X-MAP:URI="${initUri}"`);
    } else if (line && !/^segment_\d+\.m4s$/.test(line)) {
      output.push(line);
    }
  }
  return `${output.join("\n")}\n`;
}
