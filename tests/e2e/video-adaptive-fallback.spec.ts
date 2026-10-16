import { access } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { startMultilingualFixture } from "../fixtures/multilingual";

test("Auto downshifts to a prepared rendition after a mid-video bandwidth drop", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Real H.264/AAC playback and CDP bandwidth throttling require Chromium.",
  );
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await startMultilingualFixture(
    "http://127.0.0.1:5173",
    0,
    130.25,
    480,
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(fixture.origin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Open multilingual.mkv" }).click();
    const video = page.getByLabel("Video preview");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(2);
    await page
      .getByRole("button", { name: "Maximize preview", exact: true })
      .click();
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
    });
    await expect(
      page.getByText("Auto · 480p playback", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Quality", exact: true }).click();
    await page.getByRole("option", { name: "480p", exact: true }).click();
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      v.currentTime = 64;
      await v.play();
    });
    await expect(page.getByText("480p playback", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(
        () =>
          video.evaluate(
            (v: HTMLVideoElement) => !v.seeking && v.currentTime > 64.5,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const entry = await fixture.runtime.ensureVideoTranscodeEntry(
      fixture.session,
      "multilingual.mkv",
      path.join(fixture.directory, "multilingual.mkv"),
    );
    const low = entry.renditions.get("360p");
    if (!low) throw new Error("Low fallback is missing.");
    const fallbacks: { index: number; cached: boolean }[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        !url.pathname.endsWith("/hls/segment") ||
        url.searchParams.get("quality") !== "360p"
      )
        return;
      const index = Number(url.searchParams.get("index"));
      const record = { index, cached: false };
      fallbacks.push(record);
      void access(
        path.join(
          low.dir,
          `window-${Math.floor(index / 2) * 2}`,
          `segment_${String(index).padStart(6, "0")}.m4s`,
        ),
      ).then(
        () => {
          record.cached = true;
        },
        () => undefined,
      );
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: 75_000,
      uploadThroughput: -1,
    });
    await page.getByRole("button", { name: "Quality", exact: true }).click();
    await page.getByRole("option", { name: "Auto", exact: true }).click();
    await expect
      .poll(() => fallbacks.length, { timeout: 45_000 })
      .toBeGreaterThan(0);
    expect(fallbacks[0].index).toBeGreaterThan(0);
    await expect.poll(() => fallbacks[0].cached).toBe(true);
    await expect(
      page.getByText("Auto · 360p playback", { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
        timeout: 10_000,
      })
      .toBeGreaterThan(before + 1);
    expect(errors).toEqual([]);
    await cdp.detach();
  } finally {
    await page.close();
    await fixture.close();
  }
});
