import { describe, expect, it } from "vitest";
import {
  buildMasterPlaylist,
  buildVariantPlaylist,
  calculateRenditions,
  codecsFromInit,
  publishedSegments,
} from "./hlsManifest.js";

describe("adaptive HLS manifests", () => {
  it("builds a source-bounded ladder ordered by bandwidth", () => {
    expect(calculateRenditions({ width: 1920, height: 1080 })).toEqual([
      { id: "360p", width: 640, height: 360, bandwidth: 1_020_800 },
      { id: "480p", width: 854, height: 480, bandwidth: 1_680_800 },
      { id: "720p", width: 1280, height: 720, bandwidth: 3_220_800 },
      { id: "1080p", width: 1920, height: 1080, bandwidth: 5_640_800 },
    ]);
  });

  it("never upscales a small source", () => {
    expect(calculateRenditions({ width: 640, height: 360 })).toEqual([
      { id: "360p", width: 640, height: 360, bandwidth: 1_020_800 },
    ]);
  });

  it("uses a source rendition below the ladder and rejects invalid dimensions", () => {
    expect(calculateRenditions({ width: 320, height: 180 })).toEqual([
      {
        id: "source",
        width: 320,
        height: 180,
        bandwidth: 1_020_800,
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
      "#EXT-X-STREAM-INF:BANDWIDTH=1020800,RESOLUTION=640x360",
    );
    expect(playlist).toContain("variants/720p/index.m3u8");
    expect(playlist).not.toContain("CODECS=");
  });

  it("reads video level and optional audio from encoded init data", () => {
    const video = Buffer.from("avcC\x01\x4d\x40\x1f", "latin1");
    expect(codecsFromInit(video)).toBe("avc1.4d401f");
    expect(codecsFromInit(Buffer.concat([video, Buffer.from("mp4a")]))).toBe(
      "avc1.4d401f,mp4a.40.2",
    );
    expect(codecsFromInit(Buffer.from("empty"))).toBeUndefined();
  });

  it("uses FFmpeg's real durations and segment numbers, including gaps", () => {
    const source =
      '#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.125,\nsegment_000000.m4s\n#EXTINF:2.375,\nsegment_000002.m4s\n#EXT-X-ENDLIST\n';
    const playlist = buildVariantPlaylist(
      source,
      "/init",
      (index) => `/segment?index=${String(index)}`,
    );

    expect(publishedSegments(source)).toEqual([0, 2]);
    expect(playlist).toContain('#EXT-X-MAP:URI="/init"');
    expect(playlist).toContain("#EXT-X-TARGETDURATION:5");
    expect(playlist).toContain("#EXTINF:4.125,\n/segment?index=0");
    expect(playlist).toContain("#EXTINF:2.375,\n/segment?index=2");
    expect(playlist).not.toContain("index=1");
    expect(playlist).toContain("#EXT-X-ENDLIST");
  });

  it("does not publish a segment before its playlist entry is complete", () => {
    const source =
      "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.000,\nsegment_000000.m4s\n#EXTINF:1.000,\nsegment_000001.m4s";
    const playlist = buildVariantPlaylist(
      source,
      "/init",
      (index) => `/segment?index=${String(index)}`,
    );
    expect(publishedSegments(source)).toEqual([0]);
    expect(playlist).toContain("/segment?index=0");
    expect(playlist).not.toContain("index=1");
    expect(playlist).not.toContain("#EXT-X-ENDLIST");
  });
});
