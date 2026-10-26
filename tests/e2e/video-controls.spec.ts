import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { test } from "./media-fixture";
import { filenames, installReviewFixtures, reviewSubtitles } from "../review/fixtures";
import { tapVisibleTarget } from "./touch";
import { setCssViewport } from "./helpers/viewport";

test.use({ hasTouch: true });

test("one timeline controls real playback, Settings, captions and native recovery", async ({
  page,
  appOrigin,
  browserName,
}) => {
  test.setTimeout(60_000);
  await setCssViewport(page, 1280, 720);
  await installReviewFixtures(page);
  await page.route("**/api/sessions/*/video/play?*", (route) => route.continue());
  await page.goto(appOrigin);
  await page.getByRole("tab", { name: "Explore" }).click();
  await page
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
  await page
    .getByRole("treeitem", {
      name: `${filenames[2]} ${filenames[2].split(".").at(-1)}`,
      exact: true,
    })
    .click();
  const video = page.getByLabel("Video preview");
  const seek = page.getByRole("slider", { name: "Seek video" });
  const settings = page.getByText("Video settings", { exact: true });
  await expect(seek).toBeVisible();
  await expect(video).toHaveJSProperty("controls", false);
  await expect(page.getByRole("combobox", { name: "Quality", exact: true })).toHaveCount(0);
  await tapVisibleTarget(page.getByRole("button", { name: "Mute video", exact: true }));
  await page.getByRole("button", { name: "Play video", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.3);
  await tapVisibleTarget(page.getByRole("button", { name: "Pause video", exact: true }));
  await expect(video).toHaveJSProperty("paused", true);
  await settings.click();
  await page.getByLabel("Playback speed", { exact: true }).fill("1.5");
  await expect(video).toHaveJSProperty("playbackRate", 1.5);
  await page.getByLabel("Subtitle file", { exact: true }).setInputFiles(reviewSubtitles);
  await expect(
    page.getByRole("button", { name: /^Captions (on|off)$/, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "Caption size", exact: true }).press("Escape");
  await expect(settings).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Caption size", exact: true })).toHaveCount(0);
  expect(
    await video.evaluate((v: HTMLVideoElement) =>
      Array.from(v.textTracks).some((track) => track.mode === "showing"),
    ),
  ).toBe(true);
  if (browserName === "chromium") {
    await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
    await expect(page.locator(".video-shell")).toHaveJSProperty(
      "offsetWidth",
      await page.evaluate(() => innerWidth),
    );
    expect(await page.evaluate(() => document.fullscreenElement?.className)).toBe("video-shell");
    await expect(seek).toBeVisible();
    await settings.click();
    await expect(page.getByRole("combobox", { name: "Quality", exact: true })).toBeVisible();
    await settings.click();
    await expect(video).toHaveJSProperty("controls", false);
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    for (const viewport of [
      { width: 360, height: 640 },
      { width: 844, height: 390 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
      await expect(seek).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Exit fullscreen", exact: true }),
      ).toBeInViewport();
      await expect(video).toBeInViewport();
      await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    }
    await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
    await seek.focus();
    await page.keyboard.press("End");
    await expect(video).toHaveJSProperty("currentTime", 8);
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await page.getByRole("button", { name: "Maximize preview", exact: true }).click();
    await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  }
  for (const width of [320, 390, 820, 1440, 2560]) {
    await setCssViewport(page, width, width === 820 ? 390 : 1080);
    if (width <= 820) await page.locator('label[for="workspace-pane-preview"]').click();
    await expect(seek).toBeVisible();
    await settings.click();
    await expect(page.getByRole("combobox", { name: "Quality", exact: true })).toBeVisible();
    await settings.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await settings.click();
  await page.getByRole("checkbox", { name: "Use browser controls" }).check();
  await expect(video).toHaveJSProperty("controls", true);
  await expect(seek).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Use browser controls" }).uncheck();
  await expect(video).toHaveJSProperty("controls", false);
  await expect(seek).toHaveCount(1);
  const accessibility = await new AxeBuilder({ page }).include(".video-shell").analyze();
  expect(accessibility.violations).toEqual([]);
  await video.evaluate((v: HTMLVideoElement) => {
    Object.defineProperty(v, "play", {
      value: () => Promise.reject(new DOMException("Playback blocked", "NotAllowedError")),
    });
  });
  await page.getByRole("button", { name: "Play video", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(video).toHaveJSProperty("controls", true);
  await expect(video).toBeFocused();
  await expect(seek).toHaveCount(0);
});
