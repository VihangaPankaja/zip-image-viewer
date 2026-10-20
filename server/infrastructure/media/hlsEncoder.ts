import { mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { HlsEncoderPreference } from "../../config/runtimeConstants.js";
import {
  buildFmp4HlsArgs,
  type Fmp4HlsInput,
  type HlsVideoEncoder,
} from "../../media/ffmpegHls.js";
import { runCommand, runCommandCapture } from "../process/commandRunner.js";

type LogEvent = (
  _level: "info" | "warn" | "error",
  _event: string,
  _details?: Record<string, unknown>,
) => void;

// Call within the shared media-work slot, including capability probes and retries.
export class HlsEncoder {
  private selected: HlsVideoEncoder | undefined;
  private hardwareDisabled = false;

  constructor(
    private readonly executable: string,
    private readonly preference: HlsEncoderPreference,
    private readonly logEvent: LogEvent,
  ) {}

  private async detect(signal?: AbortSignal): Promise<HlsVideoEncoder> {
    if (this.selected) return this.selected;
    if (this.preference === "cpu") return "libx264";
    const probeSignal = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
    try {
      const { stdout } = await runCommandCapture(this.executable, ["-hide_banner", "-encoders"], {
        signal: probeSignal,
      });
      const candidates =
        this.preference === "auto" ? (["h264_qsv", "h264_nvenc"] as const) : [this.preference];
      for (const encoder of candidates) {
        if (!new RegExp(`\\b${encoder}\\b`).test(stdout)) continue;
        try {
          await runCommand(
            this.executable,
            [
              "-hide_banner",
              "-loglevel",
              "error",
              "-f",
              "lavfi",
              "-i",
              "color=size=128x128:rate=30",
              "-frames:v",
              "2",
              "-c:v",
              encoder,
              "-pix_fmt",
              "nv12",
              "-f",
              "null",
              "-",
            ],
            { signal: probeSignal },
          );
          if (this.hardwareDisabled) return "libx264";
          this.selected = encoder;
          this.logEvent("info", "video.encoder.selected", { encoder });
          return encoder;
        } catch {
          signal?.throwIfAborted();
          this.logEvent("warn", "video.encoder.unavailable", { encoder });
        }
      }
    } catch {
      signal?.throwIfAborted();
    }
    this.hardwareDisabled = true;
    this.selected = "libx264";
    this.logEvent("warn", "video.encoder.fallback", {
      requested: this.preference,
      encoder: "libx264",
      reason: "Hardware encoder or device unavailable; using CPU.",
    });
    return this.selected;
  }

  async encode(input: Fmp4HlsInput, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const encoder = input.audioStreamIndex === undefined ? await this.detect(signal) : "libx264";
    if (encoder === "libx264") {
      await runCommand(this.executable, buildFmp4HlsArgs(input), { signal });
      return;
    }
    // Publish only after success so a CPU retry cannot mix initialization files.
    const temporary = await mkdtemp(path.join(input.outputDirectory, ".encode-"));
    try {
      try {
        await runCommand(
          this.executable,
          buildFmp4HlsArgs({
            ...input,
            outputDirectory: temporary,
            encoder,
          }),
          { signal },
        );
      } catch {
        signal?.throwIfAborted();
        this.hardwareDisabled = true;
        this.selected = "libx264";
        this.logEvent("warn", "video.encoder.fallback", {
          requested: encoder,
          encoder: "libx264",
          reason: "Hardware encode failed; retrying on CPU.",
        });
        await rm(temporary, { recursive: true, force: true });
        await runCommand(this.executable, buildFmp4HlsArgs(input), { signal });
        return;
      }
      signal?.throwIfAborted();
      const files = await readdir(temporary);
      for (const name of files.filter((name) => name !== "index.m3u8"))
        await rename(path.join(temporary, name), path.join(input.outputDirectory, name));
      await rename(
        path.join(temporary, "index.m3u8"),
        path.join(input.outputDirectory, "index.m3u8"),
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
