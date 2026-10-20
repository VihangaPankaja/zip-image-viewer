import { expect, test } from "@playwright/test";
import { startMultilingualFixture } from "../fixtures/multilingual";

test("opt-in playback recovers when staged output outlasts the normal playlist retry budget", async ({
  page,
  baseURL,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Real H.264/AAC decoding uses Chromium's bundled codecs.");
  test.setTimeout(60_000);
  if (!baseURL) throw new Error("App URL is required.");
  const fixture = await startMultilingualFixture(baseURL, 0, 20, 360, undefined, "h264_nvenc");
  let preparing = 0;
  try {
    await page.route("**/video/hls/playlist?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("quality") === "360p" && preparing < 4) {
        preparing++;
        expect(route.request().headers()["x-hls-preparation-retry"]).toBe("1");
        await route.fulfill({
          status: 425,
          json: { error: "Rendition is being prepared." },
        });
      } else await route.continue();
    });
    await page.goto(fixture.origin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Open multilingual.mkv" }).click();
    const video = page.getByLabel("Video preview");
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), {
        timeout: 40_000,
      })
      .toBeGreaterThanOrEqual(2);
    expect(preparing).toBe(4);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(1);
  } finally {
    await page.close();
    await fixture.close();
  }
});

for (const status of [404, 503]) {
  test(`opt-in playback stops retrying a terminal ${status} playlist`, async ({
    page,
    baseURL,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "HLS.js decoding runs in Chromium.");
    test.setTimeout(30_000);
    if (!baseURL) throw new Error("App URL is required.");
    const fixture = await startMultilingualFixture(baseURL);
    let attempts = 0;
    try {
      await page.route("**/video/hls/playlist?*", async (route) => {
        if (new URL(route.request().url()).searchParams.get("quality") !== "360p")
          return route.continue();
        attempts++;
        await route.fulfill({
          status,
          json: { error: "Rendition could not be prepared." },
        });
      });
      await page.goto(fixture.origin);
      await page.getByRole("tab", { name: "Explore" }).click();
      await page.getByRole("button", { name: "Open multilingual.mkv" }).click();
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
      expect(attempts).toBeLessThanOrEqual(3);
    } finally {
      await page.close();
      await fixture.close();
    }
  });
}
