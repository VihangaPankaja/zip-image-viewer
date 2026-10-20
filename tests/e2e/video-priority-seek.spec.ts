import { expect, test } from "@playwright/test";
import path from "node:path";
import { startMultilingualFixture } from "../fixtures/multilingual";

test.use({ hasTouch: true });

test("retained short video is prepared before opening and plays near its end", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Real H.264/AAC decode uses Chromium's bundled codecs.");
  test.setTimeout(60_000);
  const fixture = await startMultilingualFixture("http://127.0.0.1:5173");
  try {
    fixture.session.retained = true;
    const entry = await fixture.runtime.ensureVideoTranscodeEntry(
      fixture.session,
      "multilingual.mkv",
      path.join(fixture.directory, "multilingual.mkv"),
    );
    for (const id of ["360p", "audio-1"])
      await expect.poll(() => entry.renditions.get(id)?.status, { timeout: 30_000 }).toBe("done");
    await page.goto(fixture.origin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Open multilingual.mkv" }).click();
    const video = page.getByLabel("Video preview");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(2);
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      v.currentTime = 16;
      await v.play();
    });
    await expect
      .poll(() =>
        video.evaluate(
          (v: HTMLVideoElement) => !v.seeking && v.readyState >= 2 && v.currentTime > 16.25,
        ),
      )
      .toBe(true);
  } finally {
    await page.close();
    await fixture.close();
  }
});

test("long video supports two viewers, pointer seeking and narrow touch/keyboard seeking", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Real H.264/AAC decode uses Chromium's bundled codecs.");
  test.setTimeout(90_000);
  const fixture = await startMultilingualFixture("http://127.0.0.1:5173", 0, 130.25);
  const other = await page.context().newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    for (const viewer of [page, other]) {
      await viewer.goto(fixture.origin);
      await viewer.getByRole("tab", { name: "Explore" }).click();
      await viewer.getByRole("button", { name: "Open multilingual.mkv" }).click();
      await expect
        .poll(() => viewer.locator("video").evaluate((v: HTMLVideoElement) => v.readyState), {
          timeout: 30_000,
        })
        .toBeGreaterThanOrEqual(2);
    }
    const seek = page.getByRole("slider", { name: "Seek video" });
    await page.bringToFront();
    await seek.scrollIntoViewIfNeeded();
    const bounds = await seek.boundingBox();
    if (!bounds) throw new Error("Seek control missing.");
    await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect(page.locator(".video-scrubber-preview")).toBeVisible();
    const pointerTarget = Number(await seek.inputValue());
    expect(pointerTarget).toBeGreaterThan(90);
    await page.mouse.up();
    await other.locator("video").evaluate((v: HTMLVideoElement) => {
      v.currentTime = 40;
    });
    for (const [viewer, target] of [
      [page, pointerTarget],
      [other, 40],
    ] as const) {
      await viewer.bringToFront();
      await expect
        .poll(
          () =>
            viewer.locator("video").evaluate(
              (v: HTMLVideoElement, time) => ({
                target: time,
                currentTime: v.currentTime,
                seeking: v.seeking,
                ready: v.readyState >= 2,
                nearTarget: Math.abs(v.currentTime - time) < 2,
                buffered: Array.from({ length: v.buffered.length }, (_, i) => [
                  v.buffered.start(i),
                  v.buffered.end(i),
                ]),
              }),
              target,
            ),
          { timeout: 30_000 },
        )
        .toMatchObject({ seeking: false, ready: true, nearTarget: true });
    }
    await page.bringToFront();
    await page.setViewportSize({ width: 360, height: 844 });
    await page.getByRole("radio", { name: "Preview", exact: true }).check({ force: true });
    await seek.scrollIntoViewIfNeeded();
    const mobile = await seek.boundingBox();
    if (!mobile) throw new Error("Touch seek control missing.");
    await page.touchscreen.tap(mobile.x + mobile.width * 0.4, mobile.y + mobile.height / 2);
    await expect
      .poll(
        () =>
          page
            .locator("video")
            .evaluate(
              (v: HTMLVideoElement) =>
                !v.seeking && v.readyState >= 2 && v.currentTime > 50 && v.currentTime < 54,
            ),
        { timeout: 30_000 },
      )
      .toBe(true);
    await seek.focus();
    const touchTarget = Number(await seek.inputValue());
    await seek.press("ArrowRight");
    await expect
      .poll(
        () =>
          page
            .locator("video")
            .evaluate(
              (v: HTMLVideoElement, time) =>
                !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - time - 0.25) < 0.1,
              touchTarget,
            ),
        { timeout: 30_000 },
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    await other.close();
    await page.close();
    await fixture.close();
  }
});
