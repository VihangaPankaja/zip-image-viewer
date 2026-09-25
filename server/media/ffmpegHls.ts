import { AUDIO_BITRATE, videoBitrateForHeight } from "./hlsManifest.js";

export type Fmp4HlsInput = {
  inputPath: string;
  outputDirectory: string;
  height: number;
  segmentDurationSeconds?: number;
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
    "0:v:0",
    "-map",
    "0:a:0?",
  ];

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
    "-c:a",
    "aac",
    "-b:a",
    `${String(AUDIO_BITRATE / 1000)}k`,
    "-ac",
    "2",
    "-ar",
    "48000",
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
