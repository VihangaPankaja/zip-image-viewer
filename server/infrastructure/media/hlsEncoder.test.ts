import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HlsEncoder } from "./hlsEncoder.js";
import { runCommand, runCommandCapture } from "../process/commandRunner.js";

vi.mock("../process/commandRunner.js", () => ({
  runCommand: vi.fn(),
  runCommandCapture: vi.fn(),
}));
const run = vi.mocked(runCommand);
const capture = vi.mocked(runCommandCapture);
const log = vi.fn();
let directory: string;
const input = () => ({
  inputPath: "video.mkv",
  outputDirectory: directory,
  height: 360,
});

async function output(args: string[], contents = "complete") {
  const playlist = args.at(-1);
  if (!playlist || playlist === "-") return;
  await writeFile(playlist, contents);
  await writeFile(path.join(path.dirname(playlist), "init.mp4"), contents);
  await writeFile(
    path.join(path.dirname(playlist), "segment_000000.m4s"),
    contents,
  );
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ziv-encoder-"));
  capture.mockResolvedValue({
    stdout: " V..... h264_qsv\n V....D h264_nvenc\n",
    stderr: "",
  });
  run.mockImplementation(async (_command, args) => output(args));
});
afterEach(async () => {
  vi.resetAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it("keeps CPU and audio-only encodes free of capability probes", async () => {
  await new HlsEncoder("ffmpeg", "cpu", log).encode(input());
  expect(capture).not.toHaveBeenCalled();
  expect(run.mock.calls[0][1]).toContain("libx264");
  const audioDirectory = path.join(directory, "audio");
  await mkdir(audioDirectory);
  await new HlsEncoder("ffmpeg", "auto", log).encode({
    ...input(),
    outputDirectory: audioDirectory,
    audioStreamIndex: 1,
  });
  expect(capture).not.toHaveBeenCalled();
  expect(run.mock.calls[1][1]).not.toContain("-c:v");
});

it("probes the device, caches its choice and publishes the completed hardware output", async () => {
  const encoder = new HlsEncoder("ffmpeg", "auto", log);
  let checkedPublication = false;
  run.mockImplementation(async (_command, args) => {
    if (args.at(-1) !== "-") {
      expect(await readdir(directory)).not.toContain("index.m3u8");
      checkedPublication = true;
    }
    await output(args);
  });
  await encoder.encode(input());
  expect(checkedPublication).toBe(true);
  expect(await readFile(path.join(directory, "index.m3u8"), "utf8")).toBe(
    "complete",
  );
  expect(
    (await readdir(directory)).some((name) => name.startsWith(".encode-")),
  ).toBe(false);
  run.mockImplementation(async (_command, args) => output(args));
  await encoder.encode(input());
  expect(capture).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledTimes(3);
  expect(run.mock.calls[1][1]).toContain("h264_qsv");
});

it("tries another available encoder when the first device is inaccessible", async () => {
  run.mockRejectedValueOnce(new Error("No Intel device"));
  await new HlsEncoder("ffmpeg", "auto", log).encode(input());
  expect(run.mock.calls[0][1]).toContain("h264_qsv");
  expect(run.mock.calls[1][1]).toContain("h264_nvenc");
  expect(run.mock.calls[2][1]).toContain("h264_nvenc");
});

it.each(["missing", "device", "listing"])(
  "falls back once to CPU for %s failure",
  async (failure) => {
    if (failure === "missing")
      capture.mockResolvedValue({ stdout: "libx264", stderr: "" });
    if (failure === "device") run.mockRejectedValueOnce(new Error("No GPU"));
    if (failure === "listing")
      capture.mockRejectedValue(new Error("Cannot inspect encoders"));
    const encoder = new HlsEncoder("ffmpeg", "h264_nvenc", log);
    await encoder.encode(input());
    await encoder.encode(input());
    expect(capture).toHaveBeenCalledTimes(1);
    expect(run.mock.lastCall?.[1]).toContain("libx264");
    expect(log).toHaveBeenCalledWith(
      "warn",
      "video.encoder.fallback",
      expect.objectContaining({ encoder: "libx264" }),
    );
  },
);

it("discards a failed hardware encode before retrying on CPU and disables future hardware attempts", async () => {
  run.mockImplementation(async (_command, args) => {
    if (args.at(-1) === "-") return;
    if (args.includes("h264_qsv")) {
      await output(args, "partial hardware");
      throw new Error("Device lost");
    }
    expect(await readdir(directory)).toEqual([]);
    await output(args, "CPU");
  });
  const encoder = new HlsEncoder("ffmpeg", "h264_qsv", log);
  await encoder.encode(input());
  expect(await readFile(path.join(directory, "init.mp4"), "utf8")).toBe("CPU");
  run.mockImplementation(async (_command, args) => output(args));
  await encoder.encode(input());
  expect(run.mock.lastCall?.[1]).toContain("libx264");
  expect(capture).toHaveBeenCalledTimes(1);
});

it.each(["listing", "probe", "encode"])(
  "honors cancellation during %s without retrying CPU",
  async (phase) => {
    const controller = new AbortController();
    const cancelled = () => {
      controller.abort(new Error("Session deleted"));
      throw controller.signal.reason;
    };
    if (phase === "listing") capture.mockImplementationOnce(cancelled);
    else
      run.mockImplementation(async (_command, args) => {
        if (phase === "probe" || args.at(-1) !== "-") cancelled();
        await Promise.resolve();
      });
    await expect(
      new HlsEncoder("ffmpeg", "auto", log).encode(input(), controller.signal),
    ).rejects.toThrow("Session deleted");
    expect(run.mock.calls.every(([, args]) => !args.includes("libx264"))).toBe(
      true,
    );
    expect(await readdir(directory)).toEqual([]);
  },
);

it("propagates CPU failures", async () => {
  run.mockRejectedValue(new Error("Invalid source"));
  await expect(
    new HlsEncoder("ffmpeg", "cpu", log).encode(input()),
  ).rejects.toThrow("Invalid source");
});

it("keeps CPU fallback when a concurrent cold device probe finishes later", async () => {
  const firstDirectory = path.join(directory, "first");
  const secondDirectory = path.join(directory, "second");
  await mkdir(firstDirectory);
  await mkdir(secondDirectory);
  let finishProbe: () => void = () => undefined;
  let probes = 0;
  run.mockImplementation(async (_command, args) => {
    if (args.at(-1) === "-") {
      probes += 1;
      if (probes === 2)
        await new Promise<void>((resolve) => {
          finishProbe = resolve;
        });
      return;
    }
    if (args.includes("h264_qsv")) throw new Error("Device lost after probe");
    await output(args);
  });
  const encoder = new HlsEncoder("ffmpeg", "auto", log);
  const first = encoder.encode({ ...input(), outputDirectory: firstDirectory });
  const second = encoder.encode({
    ...input(),
    outputDirectory: secondDirectory,
  });
  await first;
  expect(probes).toBe(2);
  finishProbe();
  await second;
  expect(
    run.mock.calls.filter(
      ([, args]) => args.at(-1) !== "-" && args.includes("h264_qsv"),
    ),
  ).toHaveLength(1);
  expect(await readFile(path.join(secondDirectory, "index.m3u8"), "utf8")).toBe(
    "complete",
  );
});
