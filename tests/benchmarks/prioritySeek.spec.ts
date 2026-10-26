import { expect, test, type Locator, type Page } from "@playwright/test";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { startMultilingualFixture } from "../fixtures/multilingual";

test.use({ hasTouch: true });

async function presentedSeek(video: Locator, target: number): Promise<number> {
  return video.evaluate(
    (v: HTMLVideoElement, time) =>
      new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const timeout = setTimeout(() => {
          v.cancelVideoFrameCallback(callback);
          reject(new Error(`No displayed frame at ${String(time)}.`));
        }, 10_000);
        let callback = v.requestVideoFrameCallback(function frame(_now, metadata) {
          if (Math.abs(metadata.mediaTime - time) < 0.25) {
            clearTimeout(timeout);
            resolve(performance.now() - started);
          } else callback = v.requestVideoFrameCallback(frame);
        });
        v.currentTime = time;
      }),
    target,
  );
}

function percentiles(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

async function resetPlayer(page: Page) {
  await page.reload();
  await page.getByRole("tab", { name: "Explore" }).click();
  await page
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: "multilingual.mkv" })
    .click();
  await page.getByText("Video settings", { exact: true }).click();
  await page.getByRole("combobox", { name: "Audio language" }).selectOption({ label: "Spanish" });
  const video = page.getByLabel("Video preview");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), {
      timeout: 30_000,
    })
    .toBe(4);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
}

test("cold hour seeks, crosses windows and preserves alternate audio on desktop and touch", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "The real H.264/AAC decode fixture uses Chromium's bundled codecs.",
  );
  test.setTimeout(240_000);
  await rm("test-results/priority-seek-metrics.json", { force: true });
  const fixture = await startMultilingualFixture("http://127.0.0.1:5173", 0, 3600);
  try {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(fixture.origin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page
      .getByRole("list", { name: "Sessions", exact: true })
      .getByRole("button", { name: "multilingual.mkv" })
      .click();
    await page.getByText("Video settings", { exact: true }).click();
    const video = page.getByLabel("Video preview");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.duration), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(3599);
    await video.evaluate((v: HTMLVideoElement) => {
      v.muted = true;
    });
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(2);
    const coldMs = await presentedSeek(video, 2880);
    const coldEntry = fixture.deps.videoTranscodeStore.values().next().value;
    const coldEncoderWaitMs = Object.fromEntries(
      [...(coldEntry?.renditions ?? [])].map(([id, state]) => [id, state.encoderWaitMs ?? null]),
    );
    expect(coldMs).toBeLessThan(3000);
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await expect
      .poll(
        () =>
          video.evaluate(
            (v: HTMLVideoElement) =>
              !v.seeking && v.readyState >= 2 && v.currentTime >= 2880 && v.currentTime < 2890,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const audio = page.getByRole("combobox", { name: "Audio language" });
    await audio.selectOption({ label: "Spanish" });
    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = 2894;
    });
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
        timeout: 30_000,
      })
      .toBeGreaterThan(2897);
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    const entry = fixture.deps.videoTranscodeStore.values().next().value;
    if (!entry) throw new Error("The browser did not request adaptive video.");
    const targets = Array.from({ length: 30 }, (_, index) => 82 + index * 104);
    for (const target of targets)
      await Promise.all(
        ["360p", "audio-2"].map((id) =>
          fixture.runtime.startPrioritySegmentWindow(
            entry,
            fixture.session,
            fixture.runtime.getRenditionState(entry, fixture.session, id),
            Math.floor(target / 4),
          ),
        ),
      );
    await resetPlayer(page);
    const prepared: number[] = [];
    for (const target of targets) {
      expect(
        await video.evaluate(
          (v: HTMLVideoElement, time) =>
            Array.from({ length: v.buffered.length }, (_, i) => [
              v.buffered.start(i),
              v.buffered.end(i),
            ]).some(([start, end]) => start <= time && end > time),
          target,
        ),
      ).toBe(false);
      prepared.push(await presentedSeek(video, target));
    }
    expect(percentiles(prepared).p95).toBeLessThan(500);
    // Start with a fresh media buffer; earlier seeks may remain buffered even
    // after a distant seek, which would bypass the network measurement.
    await resetPlayer(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 10,
      downloadThroughput: 1_250_000,
      uploadThroughput: -1,
    });
    const limited: number[] = [];
    for (const target of targets) {
      expect(
        await video.evaluate(
          (v: HTMLVideoElement, time) =>
            Array.from({ length: v.buffered.length }, (_, i) => [
              v.buffered.start(i),
              v.buffered.end(i),
            ]).some(([start, end]) => start <= time && end > time),
          target + 1,
        ),
      ).toBe(false);
      limited.push(await presentedSeek(video, target + 1));
    }
    expect(percentiles(limited).p95).toBeLessThan(1500);
    await cdp.detach();
    await page.setViewportSize({ width: 360, height: 844 });
    await page.getByRole("radio", { name: "Preview", exact: true }).check({ force: true });
    const seek = page.getByRole("slider", { name: "Seek video" });
    await seek.focus();
    await seek.press("ArrowRight");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => !v.seeking && v.readyState >= 2))
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    const report = {
      generated: new Date().toISOString(),
      machine: os.cpus()[0]?.model,
      platform: `${os.platform()} ${os.release()}`,
      source: {
        width: entry.width,
        height: entry.height,
        durationSeconds: entry.durationSeconds,
        codecs: "H.264 / two AAC audio languages",
      },
      coldMs,
      coldEncoderWaitMs,
      lan: percentiles(prepared),
      controlled10Mbps: percentiles(limited),
      lanSamples: prepared,
      limitedSamples: limited,
    };
    await writeFile("test-results/priority-seek-metrics.json", JSON.stringify(report, null, 2));
    await test.info().attach("prepared-seeks.json", {
      body: JSON.stringify(report),
      contentType: "application/json",
    });
  } finally {
    await fixture.close();
  }
});
