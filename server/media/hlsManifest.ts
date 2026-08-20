export type VideoDimensions = {
  width: number;
  height: number;
};

export type HlsRendition = VideoDimensions & {
  id: string;
  bandwidth: number;
};

const LADDER = [
  { height: 360, bandwidth: 800_000 },
  { height: 480, bandwidth: 1_400_000 },
  { height: 720, bandwidth: 2_800_000 },
  { height: 1080, bandwidth: 5_000_000 },
  { height: 1440, bandwidth: 8_000_000 },
  { height: 2160, bandwidth: 14_000_000 },
] as const;

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
  ).map(({ height, bandwidth }) => ({
    id: `${String(height)}p`,
    width: evenWidth(dimensions, height),
    height,
    bandwidth,
  }));

  if (renditions.length > 0) return renditions;
  return [
    {
      id: "source",
      width: dimensions.width,
      height: dimensions.height,
      bandwidth: 600_000,
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
      `#EXT-X-STREAM-INF:BANDWIDTH=${String(rendition.bandwidth)},RESOLUTION=${String(rendition.width)}x${String(rendition.height)},CODECS="avc1.4d401f,mp4a.40.2"`,
      getUri(rendition),
    );
  }
  return `${lines.join("\n")}\n`;
}

export type VariantPlaylistInput = {
  availableSegments: number;
  complete: boolean;
  durationSeconds: number;
  segmentDurationSeconds: number;
};

export function buildVariantPlaylist(input: VariantPlaylistInput): string {
  const segmentDuration = Math.max(1, input.segmentDurationSeconds);
  const count = Math.max(0, Math.floor(input.availableSegments));
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${String(Math.ceil(segmentDuration))}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:EVENT",
    '#EXT-X-MAP:URI="init.mp4"',
  ];

  for (let index = 0; index < count; index += 1) {
    const remaining = input.durationSeconds - index * segmentDuration;
    const duration =
      input.durationSeconds > 0
        ? Math.max(0.001, Math.min(segmentDuration, remaining))
        : segmentDuration;
    lines.push(
      `#EXTINF:${duration.toFixed(3)},`,
      `segment_${String(index).padStart(6, "0")}.m4s`,
    );
  }

  if (input.complete) lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}
