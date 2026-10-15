import { runCommandCapture } from "../process/commandRunner.js";

// Container duration can include AAC padding after the last video frame.
export async function videoDuration(
  executable: string,
  input: string,
  containerDuration: number,
  signal?: AbortSignal,
): Promise<number> {
  const first = await runCommandCapture(
    executable,
    [
      "-hide_banner",
      "-copyts",
      "-start_at_zero",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-vf",
      "select=eq(n\\,0),showinfo",
      "-frames:v",
      "1",
      "-fps_mode",
      "passthrough",
      "-f",
      "null",
      "-",
    ],
    { signal },
  );
  const { stderr } = await runCommandCapture(
    executable,
    [
      "-hide_banner",
      "-sseof",
      "-4",
      "-copyts",
      "-start_at_zero",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-vf",
      "showinfo",
      "-fps_mode",
      "passthrough",
      "-f",
      "null",
      "-",
    ],
    { signal },
  );
  const frames = [
    ...stderr.matchAll(
      /pts_time:([\d.]+)\s+duration:\s*\d+\s+duration_time:([\d.]+)/g,
    ),
  ];
  const last = frames.at(-1);
  const firstTime = first.stderr.match(/pts_time:([-\d.]+)/)?.[1];
  const end =
    last && firstTime !== undefined
      ? Number(last[1]) + Number(last[2]) - Number(firstTime)
      : 0;
  if (!Number.isFinite(end) || end <= 0 || end > containerDuration + 0.1)
    throw new Error("Could not determine the video's final frame.");
  return Math.min(containerDuration, Math.round(end * 1_000_000) / 1_000_000);
}
