import { AUDIO_BITRATE, videoBitrateForHeight } from "./hlsManifest.js";

export type Fmp4HlsInput = {
  inputPath: string;
  outputDirectory: string;
  height: number;
  segmentDurationSeconds?: number;
  audioStreamIndex?: number;
  videoOnly?: boolean;
};

function mediaPath(directory: string, filename: string): string {
  return `${directory.replace(/\\/g, "/").replace(/\/$/, "")}/${filename}`;
}

export function buildFmp4HlsArgs(input: Fmp4HlsInput): string[] {
  const duration = Math.max(1, input.segmentDurationSeconds ?? 4);
  const bitrate = `${String(videoBitrateForHeight(input.height) / 1000)}k`;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input.inputPath,
    "-map",
    input.audioStreamIndex === undefined
      ? "0:v:0"
      : `0:${String(input.audioStreamIndex)}`,
  ];
  if (input.audioStreamIndex === undefined) {
    if (!input.videoOnly) args.push("-map", "0:a:0?");
    if (input.height > 0) args.push("-vf", `scale=-2:${String(input.height)}`);
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      bitrate,
      "-maxrate",
      bitrate,
      "-bufsize",
      bitrate,
      "-sc_threshold",
      "0",
      "-force_key_frames",
      `expr:gte(t,n_forced*${String(duration)})`,
    );
  }
  if (!input.videoOnly)
    args.push(
      "-c:a",
      "aac",
      "-b:a",
      `${String(AUDIO_BITRATE / 1000)}k`,
      "-ac",
      "2",
      "-ar",
      "48000",
    );
  args.push(
    "-f",
    "hls",
    "-hls_time",
    String(duration),
    "-hls_playlist_type",
    "event",
    "-hls_flags",
    "temp_file",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    mediaPath(input.outputDirectory, "segment_%06d.m4s"),
    mediaPath(input.outputDirectory, "index.m3u8"),
  );
  return args;
}

export function buildFmp4AudioGroupArgs(
  inputPath: string,
  outputs: readonly { index: number; directory: string }[],
  segmentDurationSeconds: number,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    ...outputs.flatMap(({ index, directory }) =>
      buildFmp4HlsArgs({
        inputPath,
        outputDirectory: directory,
        height: 0,
        audioStreamIndex: index,
        segmentDurationSeconds,
      }).slice(5),
    ),
  ];
}
