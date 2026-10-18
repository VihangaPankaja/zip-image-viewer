import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Session, VideoTranscodeEntry } from "../domain/models.js";
import { buildTree } from "../domain/explorerTree.js";
import { createRuntimeMedia } from "./runtimeMedia.js";

const encoding = vi.hoisted(() => ({
  completed: 0,
  duration: 128,
  before: (): Promise<void> => Promise.resolve(),
  during: (_playlist: string): Promise<void> => Promise.resolve(),
}));
vi.mock("../config/runtimeConstants.js", async (original) => ({
  ...(await original<typeof import("../config/runtimeConstants.js")>()),
  MEDIA_CACHE_BUDGET_BYTES: 512,
}));
vi.mock("../infrastructure/media/videoDuration.js", () => ({
  probeVideoMetadata: () =>
    Promise.resolve({
      width: 640,
      height: 360,
      durationSeconds: encoding.duration,
    }),
}));
vi.mock("../infrastructure/process/commandRunner.js", () => ({
  runCommandCapture: () =>
    Promise.resolve({
      stdout: "",
      stderr: `Duration: ${encoding.duration === 8 ? "00:00:08" : "00:02:08"}.00\nVideo: h264, 640x360`,
    }),
  runCommand: async (_command: string, args: string[]) => {
    await encoding.before();
    const playlist = args.at(-1);
    if (!playlist) throw new Error("Missing encoder output.");
    const directory = path.dirname(playlist);
    const start = args.includes("-start_number")
      ? Number(args[args.indexOf("-start_number") + 1])
      : 0;
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "init.mp4"), "initialization");
    const segments = [start, start + 1].map(
      (index) => `segment_${String(index).padStart(6, "0")}.m4s`,
    );
    for (const segment of segments)
      await writeFile(path.join(directory, segment), "x".repeat(300));
    await writeFile(
      playlist,
      `#EXTM3U\n${segments.map((segment) => `#EXTINF:4.000000,\n${segment}`).join("\n")}\n#EXT-X-ENDLIST\n`,
    );
    await encoding.during(playlist);
    encoding.completed += 1;
  },
}));

afterEach(() => {
  encoding.completed = 0;
  encoding.before = () => Promise.resolve();
  encoding.during = () => Promise.resolve();
});

it.each([
  [1, 8, false],
  [2, 8, false],
  [1, 128, false],
  [2, 128, false],
  [2, 8, true],
  [2, 128, true],
] as const)(
  "enforces retained cache budget across %i videos of %i seconds with interactive discovery %s",
  async (count, duration, interactive) => {
    encoding.duration = duration;
    const directory = await mkdtemp(path.join(tmpdir(), "retained-budget-"));
    const files = Array.from(
      { length: count },
      (_value, index) => `clip-${index}.mkv`,
    );
    for (const file of files)
      await writeFile(path.join(directory, file), "original");
    const session = {
      id: "retained-budget",
      retained: true,
      workspaceDir: directory,
      extractDir: directory,
      tree: buildTree(
        files.map((relativePath) => ({
          relativePath,
          type: "file",
          size: 8,
          modifiedAt: 0,
        })),
        "retained",
      ).tree,
    } as Session;
    const entries = new Map<string, VideoTranscodeEntry>();
    const log = vi.fn();
    const media = createRuntimeMedia(
      "ffmpeg",
      new Map([[session.id, session]]),
      entries,
      log,
    );
    const sizes: number[] = [];
    encoding.before = async () => {
      sizes.push((await media.storage(session)).transcodesBytes);
    };
    encoding.during = async (playlist) => {
      await media.enforceMediaBudget();
      expect(await readFile(playlist, "utf8")).toContain("#EXT-X-ENDLIST");
    };
    try {
      if (interactive)
        await Promise.all(
          files.map((file) =>
            media.videoRuntime.ensureVideoTranscodeEntry(
              session,
              file,
              path.join(directory, file),
            ),
          ),
        );
      else media.prepareRetainedSession(session);
      await vi.waitFor(
        () => expect(encoding.completed).toBe((duration / 8) * count),
        { timeout: 10_000 },
      );
      await Promise.all(
        files.map((file) =>
          media.videoRuntime.ensureVideoTranscodeEntry(
            session,
            file,
            path.join(directory, file),
            "background",
          ),
        ),
      );
      expect(Math.max(...sizes)).toBeLessThanOrEqual(512);
      expect(
        (await media.storage(session)).transcodesBytes,
      ).toBeLessThanOrEqual(512);
      expect(log.mock.calls.filter(([level]) => level === "warn")).toEqual([]);
      for (const file of files)
        expect(await readFile(path.join(directory, file), "utf8")).toBe(
          "original",
        );
    } finally {
      await media.videoRuntime.cleanupVideoSession(session);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
