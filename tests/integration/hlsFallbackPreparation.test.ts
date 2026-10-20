import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { startMultilingualFixture } from "../fixtures/multilingual.js";

it("cancels queued startup when its master request is abandoned", async () => {
  const fixture = await startMultilingualFixture("http://127.0.0.1:5173", 0, 130.25, 480);
  const releases: (() => void)[] = [];
  try {
    const entry = await fixture.runtime.ensureVideoTranscodeEntry(
      fixture.session,
      "multilingual.mkv",
      path.join(fixture.directory, "multilingual.mkv"),
    );
    const blockers = [0, 1].map(() =>
      fixture.runtime.runVideoTask(
        fixture.session,
        () => new Promise<void>((resolve) => releases.push(resolve)),
      ),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    const controller = new AbortController();
    const response = fetch(
      `${fixture.origin}/api/sessions/${fixture.session.id}/video/hls/master?path=multilingual.mkv`,
      { signal: controller.signal },
    ).catch(() => undefined);
    await vi.waitFor(() => expect(entry.renditions.get("360p")?.priorityJobs.size).toBe(1));
    controller.abort();
    await response;
    await vi.waitFor(() => expect(entry.renditions.get("360p")?.priorityJobs.size).toBe(0));
    releases.forEach((release) => release());
    await Promise.all(blockers);
    expect(entry.renditions.get("360p")?.availableSegments).toBe(0);
  } finally {
    releases.forEach((release) => release());
    await fixture.close();
  }
}, 45_000);

it("prepares a low fallback at two playheads and warms nearby levels without encoding the prefix", async () => {
  const fixture = await startMultilingualFixture("http://127.0.0.1:5173", 0, 130.25, 720, 1);
  try {
    const entry = await fixture.runtime.ensureVideoTranscodeEntry(
      fixture.session,
      "multilingual.mkv",
      path.join(fixture.directory, "multilingual.mkv"),
    );
    const high = fixture.runtime.getRenditionState(entry, fixture.session, "720p");
    await Promise.all(
      [8, 24].map((index) =>
        fixture.runtime.startPrioritySegmentWindow(entry, fixture.session, high, index),
      ),
    );
    for (const index of [8, 24]) {
      const low = entry.renditions.get("360p");
      expect(low, "fallback must exist before a high window is delivered").toBeDefined();
      if (!low) throw new Error("Low fallback is missing.");
      await access(path.join(low.dir, `window-${index}`, "init.mp4"));
      const middle = entry.renditions.get("480p");
      if (!middle) throw new Error("Intermediate fallback is missing.");
      await access(path.join(middle.dir, `window-${index}`, "init.mp4"));
    }
    await vi.waitFor(
      async () => {
        for (const quality of ["360p", "480p", "720p"]) {
          const rendition = entry.renditions.get(quality);
          expect(rendition).toBeDefined();
          if (!rendition) throw new Error("Warm rendition is missing.");
          for (const index of [10, 26])
            expect(
              await readFile(path.join(rendition.dir, `window-${index}`, "index.m3u8"), "utf8"),
            ).toContain("#EXT-X-ENDLIST");
        }
      },
      { timeout: 60_000 },
    );
    for (const rendition of entry.renditions.values()) {
      const windows = (await readdir(rendition.dir)).filter((name) => name.startsWith("window-"));
      expect(windows).not.toContain("window-0");
      expect(windows.length).toBeLessThanOrEqual(4);
    }
    await fixture.cache?.enforce();
    for (const quality of ["360p", "480p"])
      await access(
        path.join(entry.renditions.get(quality)?.dir ?? "missing", "window-24", "init.mp4"),
      );
  } finally {
    await fixture.close();
  }
}, 90_000);

it("starts the low rendition from an HLS master request even for a temporary short video", async () => {
  const fixture = await startMultilingualFixture("http://127.0.0.1:5173", 0, 12, 720);
  try {
    const response = await fetch(
      `${fixture.origin}/api/sessions/${fixture.session.id}/video/hls/master?path=multilingual.mkv`,
    );
    expect(response.ok).toBe(true);
    expect(await response.text()).toContain("quality=480p");
    const entry = await fixture.runtime.ensureVideoTranscodeEntry(
      fixture.session,
      "multilingual.mkv",
      path.join(fixture.directory, "multilingual.mkv"),
    );
    await vi.waitFor(() => expect(entry.renditions.get("360p")?.status).toBe("done"), {
      timeout: 20_000,
    });
    await fetch(
      `${fixture.origin}/api/sessions/${fixture.session.id}/video/hls/playlist?path=multilingual.mkv&quality=720p`,
    );
    await entry.renditions.get("720p")?.completion;
    expect(entry.renditions.get("480p")?.status).toBe("done");
  } finally {
    await fixture.close();
  }
}, 45_000);
