import { describe, expect, it } from "vitest";
import {
  buildMasterPlaylist,
  buildVariantPlaylist,
  calculateRenditions,
} from "./hlsManifest.js";

describe("adaptive HLS manifests", () => {
  it("builds a source-bounded ladder ordered by bandwidth", () => {
    expect(calculateRenditions({ width: 1920, height: 1080 })).toEqual([
      { id: "360p", width: 640, height: 360, bandwidth: 800_000 },
      { id: "480p", width: 854, height: 480, bandwidth: 1_400_000 },
      { id: "720p", width: 1280, height: 720, bandwidth: 2_800_000 },
      { id: "1080p", width: 1920, height: 1080, bandwidth: 5_000_000 },
    ]);
  });

  it("never upscales a small source", () => {
    expect(calculateRenditions({ width: 640, height: 360 })).toEqual([
      { id: "360p", width: 640, height: 360, bandwidth: 800_000 },
    ]);
  });

  it("uses a source rendition below the ladder and rejects invalid dimensions", () => {
    expect(calculateRenditions({ width: 320, height: 180 })).toEqual([
      {
        id: "source",
        width: 320,
        height: 180,
        bandwidth: 600_000,
      },
    ]);
    expect(calculateRenditions({ width: 0, height: 180 })).toEqual([]);
    expect(calculateRenditions({ width: 320, height: -1 })).toEqual([]);
  });

  it("advertises every rendition in a master playlist", () => {
    const playlist = buildMasterPlaylist(
      calculateRenditions({ width: 1280, height: 720 }),
      (rendition) => `variants/${rendition.id}/index.m3u8`,
    );

    expect(playlist).toContain(
      "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
    );
    expect(playlist).toContain("variants/720p/index.m3u8");
  });

  it("uses aligned four-second fMP4 segments and closes completed media", () => {
    const playlist = buildVariantPlaylist({
      availableSegments: 3,
      complete: true,
      durationSeconds: 10,
      segmentDurationSeconds: 4,
    });

    expect(playlist).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(playlist).toContain("#EXTINF:4.000,");
    expect(playlist).toContain("#EXTINF:2.000,");
    expect(playlist).toContain("segment_000002.m4s");
    expect(playlist).toContain("#EXT-X-ENDLIST");
  });

  it("keeps an in-progress unknown-duration playlist open", () => {
    const playlist = buildVariantPlaylist({
      availableSegments: 1.9,
      complete: false,
      durationSeconds: 0,
      segmentDurationSeconds: 0,
    });
    expect(playlist).toContain("#EXT-X-TARGETDURATION:1");
    expect(playlist).toContain("#EXTINF:1.000,");
    expect(playlist).not.toContain("#EXT-X-ENDLIST");
  });
});
