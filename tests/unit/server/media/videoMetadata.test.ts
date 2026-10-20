import { expect, it } from "vite-plus/test";
import {
  durationFromOutput,
  dimensionsFromOutput,
  qualityOptions,
  playbackModeFromOutput,
  mediaTracksFromOutput,
  videoMetadataFromOutput,
  buildVideoQualityOptions,
} from "../../../../server/media/videoMetadata.js";

it("keeps media usable when embedded language tags are malformed", () => {
  const tracks = mediaTracksFromOutput(
    "Stream #0:1(en-12): Audio: aac (LC)\nStream #0:2(en-a1): Subtitle: subrip",
  );
  expect(tracks.audioTracks).toMatchObject([{ language: "und", label: "Audio 1" }]);
  expect(tracks.subtitleTracks).toMatchObject([{ language: "und", label: "Subtitle 1" }]);
});
it("parses FFmpeg metadata and tolerates absent or malformed video details", () => {
  expect(videoMetadataFromOutput("invalid", "mp4")).toEqual({
    width: 0,
    height: 0,
    durationSeconds: 0,
    playbackMode: "transcode",
    audioTracks: [],
    subtitleTracks: [],
  });
  expect(buildVideoQualityOptions(360).options).toContainEqual({
    id: "360p",
    label: "360p",
    height: 360,
  });
  expect(durationFromOutput("Duration: 01:02:03.25")).toBe(3723.25);
  expect(durationFromOutput("Duration: N/A")).toBe(0);
  expect(dimensionsFromOutput("Audio: aac\nVideo: h264, 1920x1080")).toEqual({
    width: 1920,
    height: 1080,
  });
  expect(dimensionsFromOutput("Audio: aac")).toEqual({ width: 0, height: 0 });
  expect(dimensionsFromOutput("Video: unknown")).toEqual({
    width: 0,
    height: 0,
  });
  expect(qualityOptions({ width: 1920, height: 1080, durationSeconds: 1 }).defaultQuality).toBe(
    "720p",
  );
  expect(qualityOptions({ width: 320, height: 180, durationSeconds: 1 }).defaultQuality).toBe(
    "auto",
  );
});

it("probes stream languages, titles and defaults while excluding bitmap subtitles", () => {
  const output = `Input #0, matroska,webm, from 'C:\\private\\video.mkv':
  Stream #0:0: Video: h264, 640x360
  Stream #0:1(eng): Audio: aac (LC), 48000 Hz (default)
    Metadata:
      title           : Main audio
  Stream #0:2(jpn): Audio: opus, 48000 Hz
  Stream #0:3(eng): Subtitle: subrip (default)
    Metadata:
      title           : English captions
  Stream #0:4: Subtitle: hdmv_pgs_subtitle
  Stream #0:5: Subtitle: ass
    Metadata:
      title           : C:\\private\\secret.srt`;
  expect(mediaTracksFromOutput(output)).toEqual({
    audioTracks: [
      {
        id: "audio-1",
        index: 1,
        language: "eng",
        label: "Main audio",
        isDefault: true,
      },
      {
        id: "audio-2",
        index: 2,
        language: "jpn",
        label: "Japanese",
        isDefault: false,
      },
    ],
    subtitleTracks: [
      {
        id: "subtitle-3",
        index: 3,
        language: "eng",
        label: "English captions",
        isDefault: true,
      },
      {
        id: "subtitle-5",
        index: 5,
        language: "und",
        label: "Subtitle 2",
        isDefault: false,
      },
    ],
  });
  expect(mediaTracksFromOutput("invalid metadata")).toEqual({
    audioTracks: [],
    subtitleTracks: [],
  });
});

it("chooses direct MP4, remux, or transcode from the probed streams", () => {
  const streams =
    "Stream #0:0: Video: h264 (High), yuv420p(progressive), 640x360\n" +
    "Stream #0:1: Audio: aac (LC), 48000 Hz, stereo";
  expect(
    playbackModeFromOutput(
      `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':\n${streams}`,
      "mp4",
    ),
  ).toBe("direct");
  expect(
    playbackModeFromOutput(`Input #0, matroska,webm, from 'clip.mkv':\n${streams}`, "mkv"),
  ).toBe("remux");
  expect(
    playbackModeFromOutput(
      `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':\n${streams.replace("h264", "hevc")}`,
      "mp4",
    ),
  ).toBe("transcode");
  expect(
    playbackModeFromOutput(
      `Input #0, matroska,webm, from 'clip.mkv':\n${streams.replace("aac", "opus")}`,
      "mkv",
    ),
  ).toBe("transcode");
});
