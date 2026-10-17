import { expect, test } from "@playwright/test";
import {
  startTorrentPlaybackFixture,
  waitForPlayback,
  type TorrentPlaybackFixture,
} from "../fixtures/torrentPlayback.js";

test.use({ hasTouch: true });

test("plays and seeks a real incomplete torrent, reconnects a missing seek, and explains download-first formats", async ({
  page,
  browserName,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000);
  let fixture: TorrentPlaybackFixture | undefined;
  try {
    if (!baseURL) throw new Error("The Vite frontend URL is required");
    fixture = await startTorrentPlaybackFixture({ frontendOrigin: baseURL });
    fixture.setUploadLimit(128 * 1024);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(fixture.origin);
    const id = await fixture.enqueue();
    await page
      .getByRole("button", { name: "Review files", exact: true })
      .click();
    const choose = page.getByRole("dialog", {
      name: "Choose files",
      exact: true,
    });
    await expect(choose).toBeVisible();
    expect(fixture.requests).toEqual([]);
    await choose
      .getByRole("button", { name: "Start selected download", exact: true })
      .click();
    await expect(choose).toHaveCount(0);
    const open = page.getByRole("button", { name: "View files", exact: true });
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Torrent files",
      exact: true,
    });
    const play = dialog.getByRole("button", { name: /^Play now:/ });
    await play.nth(0).focus();
    await page.keyboard.press("Enter");
    const video = dialog.getByLabel("Early video preview", { exact: true });
    const close = dialog.getByRole("button", { name: "Close", exact: true });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Download first", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    const codec = await page.evaluate(() =>
      document
        .createElement("video")
        .canPlayType('video/mp4; codecs="avc1.42E01E"'),
    );
    if (codec) {
      await expect(video).toBeVisible();
      await video.evaluate((element: HTMLVideoElement) => {
        element.muted = true;
        void element.play().catch(() => undefined);
      });
      await expect
        .poll(
          () =>
            video.evaluate((element: HTMLVideoElement) => ({
              ready: element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
              width: element.videoWidth,
              frames: element.getVideoPlaybackQuality().totalVideoFrames,
            })),
          { timeout: 20_000 },
        )
        .toMatchObject({ ready: true, width: 640, frames: expect.any(Number) });
      await expect
        .poll(() =>
          video.evaluate(
            (element: HTMLVideoElement) =>
              element.getVideoPlaybackQuality().totalVideoFrames,
          ),
        )
        .toBeGreaterThan(0);
      const firstFrame = (await fixture.client.jobs.list()).items.find(
        (job) => job.id === id,
      );
      expect(firstFrame?.torrentFiles[0].complete).toBe(false);
      await video.evaluate((element: HTMLVideoElement) => element.pause());
      await fixture.disconnect();
      const client = fixture.client;
      await waitForPlayback(
        async () => (await client.jobs.list()).items[0].peerCount,
        (peers) => peers === 0,
      );
      await video.evaluate((element: HTMLVideoElement) => {
        element.currentTime = 32;
      });
      await expect(video).toHaveJSProperty("seeking", true);
      await page.waitForTimeout(400);
      await expect(video).toHaveJSProperty("seeking", true);
      await fixture.reconnect();
      await waitForPlayback(
        async () => (await client.jobs.list()).items[0].peerCount,
        (peers) => peers > 0,
      );
      await expect
        .poll(
          () =>
            video.evaluate((element: HTMLVideoElement) => ({
              seeking: element.seeking,
              ready: element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
              time: Math.floor(element.currentTime),
              error: element.error?.message ?? null,
            })),
          { timeout: 25_000 },
        )
        .toEqual({ seeking: false, ready: true, time: 32, error: null });
      await video.evaluate(async (element: HTMLVideoElement) => {
        await element.play();
      });
      await expect
        .poll(() =>
          video.evaluate((element: HTMLVideoElement) => element.currentTime),
        )
        .toBeGreaterThan(32.1);
      await video.evaluate((element: HTMLVideoElement) => element.pause());
      await testInfo.attach("real-torrent-decoded-and-seeked", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    } else {
      testInfo.annotations.push({
        type: "codec",
        description: `${browserName} host cannot decode H264; real swarm selection and format fallback remain exercised.`,
      });
      await expect(
        dialog.getByRole("button", { name: "Download first", exact: true }),
      ).toBeVisible();
    }
    // Both are real remuxed media files; their metadata is not replaced by route fixtures.
    await dialog
      .getByRole("button", { name: "Download first", exact: true })
      .tap();
    for (const index of [1, 2]) {
      await play.nth(index).tap();
      await expect(
        dialog.getByText(/^Download first\. Early playback requires/),
      ).toBeVisible();
      await expect(video).toHaveCount(0);
      if (index === 1)
        await dialog
          .getByRole("button", { name: "Back to files", exact: true })
          .tap();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(
      dialog.getByRole("button", { name: "Back to files", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
    expect((await fixture.client.jobs.list()).items[0].status).not.toBe(
      "error",
    );
  } finally {
    if (fixture && testInfo.status !== testInfo.expectedStatus)
      await testInfo.attach("torrent-server-output", {
        body: fixture.serverOutput(),
        contentType: "text/plain",
      });
    await page.goto("about:blank").catch(() => undefined);
    await fixture?.close();
  }
});
