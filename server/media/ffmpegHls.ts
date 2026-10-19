import { AUDIO_BITRATE, videoBitrateForHeight } from "./hlsManifest.js";

export type HlsVideoEncoder = "libx264" | "h264_qsv" | "h264_nvenc";

export type Fmp4HlsInput = {
  inputPath: string;
  outputDirectory: string;
  height: number;
  segmentDurationSeconds?: number;
  audioStreamIndex?: number;
  videoOnly?: boolean;
  encoder?: HlsVideoEncoder;
  window?: {
    startSeconds: number;
    durationSeconds: number;
    startIndex: number;
  };
};

function mediaPath(directory: string, filename: string): string {
  return `${directory.replace(/\\/g, "/").replace(/\/$/, "")}/${filename}`;
}

export function buildFmp4HlsArgs(input: Fmp4HlsInput): string[] {
  const encoder = input.encoder ?? "libx264";
  const duration = Math.max(1, input.segmentDurationSeconds ?? 4);
  const bitrate = `${String(videoBitrateForHeight(input.height) / 1000)}k`;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    ...(input.window ? ["-ss", String(input.window.startSeconds)] : []),
    "-i",
    input.inputPath,
    ...(input.window ? ["-t", String(input.window.durationSeconds)] : []),
    "-map",
    input.audioStreamIndex === undefined ? "0:v:0" : `0:${String(input.audioStreamIndex)}`,
  ];
  if (input.audioStreamIndex === undefined) {
    if (!input.videoOnly) args.push("-map", "0:a:0?");
    if (input.height > 0) args.push("-vf", `scale=-2:${String(input.height)}`);
    args.push(
      "-c:v",
      encoder,
      "-preset",
      encoder === "h264_nvenc" ? "p4" : "veryfast",
      "-profile:v",
      "main",
      "-pix_fmt",
      encoder === "h264_qsv" ? "nv12" : "yuv420p",
      "-b:v",
      bitrate,
      "-maxrate",
      bitrate,
      "-bufsize",
      bitrate,
      ...(encoder === "libx264" ? ["-sc_threshold", "0"] : []),
      ...(encoder === "h264_qsv" ? ["-forced_idr", "1"] : []),
      ...(encoder === "h264_nvenc" ? ["-forced-idr", "1"] : []),
      "-force_key_frames",
      `expr:gte(t,n_forced*${String(duration)})`,
    );
    if (input.window) args.push("-r", "30", "-fps_mode", "cfr", "-bf", "0");
  }
  if (!input.videoOnly) {
    if (input.window) args.push("-af", "aresample=async=1:first_pts=0,apad");
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
  }
  args.push(
    ...(input.window ? ["-start_number", String(input.window.startIndex)] : []),
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
