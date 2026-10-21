import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vite-plus/test";
import type { Session } from "../../../../server/domain/models.js";
import { createRuntimeMedia } from "../../../../server/bootstrap/runtimeMedia.js";

const images = vi.hoisted(() => ({
  active: 0,
  peak: 0,
  finish: [] as { source: string; run: () => void }[],
}));
vi.mock("sharp", async () => {
  const { writeFile } = await import("node:fs/promises");
  return {
    default: (source: string) => {
      const pipeline = {
        rotate: () => pipeline,
        resize: () => pipeline,
        jpeg: () => pipeline,
        flatten: () => pipeline,
        toFile: (filename: string) =>
          new Promise<void>((resolve, reject) => {
            images.active += 1;
            images.peak = Math.max(images.peak, images.active);
            images.finish.push({
              source,
              run: () => {
                images.active -= 1;
                void writeFile(filename, "rendered image").then(resolve, reject);
              },
            });
          }),
      };
      return pipeline;
    },
  };
});

it.each(["one.jpg", "two.jpg"])(
  "shares the two-job media budget when %s finishes first",
  async (first) => {
    const workspace = await mkdtemp(path.join(tmpdir(), "image-work-budget-"));
    const session = {
      id: "session",
      workspaceDir: workspace,
      extractDir: workspace,
    } as Session;
    const media = createRuntimeMedia(
      null,
      new Map([[session.id, session]]),
      new Map(),
      () => undefined,
    );
    const jobs = [
      media.ensureThumbnail(session, "one.jpg", "one.jpg", 100),
      media.ensureImagePreview(session, "two.jpg", "two.jpg", "low"),
      media.ensureThumbnail(session, "three.jpg", "three.jpg", 100),
    ];
    try {
      await vi.waitFor(() => expect(images.active).toBe(2));
      expect(images.peak).toBe(2);
      const index = images.finish.findIndex(({ source }) => source === first);
      expect(index).toBeGreaterThanOrEqual(0);
      images.finish.splice(index, 1)[0]?.run();
      await Promise.race(jobs);
      await vi.waitFor(() => expect(images.active).toBe(2));
      while (images.finish.length) images.finish.shift()?.run();
      const output = await Promise.all(jobs);
      expect(images.peak).toBe(2);
      expect(await Promise.all(output.map((filename) => readFile(filename, "utf8")))).toEqual([
        "rendered image",
        "rendered image",
        "rendered image",
      ]);
    } finally {
      const cleanup = media.videoRuntime.cleanupVideoSession(session);
      while (images.finish.length) images.finish.shift()?.run();
      await Promise.allSettled(jobs);
      await cleanup;
      await rm(workspace, { recursive: true, force: true });
    }
  },
);
