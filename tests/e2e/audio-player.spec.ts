import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test } from "./media-fixture";
import { filenames } from "../review/fixtures";
import { installAudioReviewFixtures, secondAudio } from "../review/audioFixtures";
import { tapVisibleTarget } from "./touch";
import { setCssViewport } from "./helpers/viewport";

test.use({ hasTouch: true });

async function serveRealAudio(page: Page) {
  // WebKit media decoding needs real HTTP range responses, as the video fixtures do.
  await page.route("**/api/sessions/*/file?*", (route) =>
    new URL(route.request().url()).searchParams.get("path")?.endsWith(".wav")
      ? route.continue()
      : route.fallback(),
  );
}

async function openAudio(page: Page, origin: string) {
  await installAudioReviewFixtures(page);
  await serveRealAudio(page);
  await page.goto(origin);
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
  await page
    .getByRole("treeitem", {
      name: `${filenames[3]} ${filenames[3].split(".").at(-1)}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("slider", { name: "Audio position" })).toBeEnabled();
}

test("real audio stays silent on first open, seeks by keyboard, and survives view changes", async ({
  page,
  appOrigin,
  browserName,
}) => {
  await openAudio(page, appOrigin);
  const audio = page.getByLabel("Audio playback");
  await expect(audio).toHaveJSProperty("paused", true);
  await expect(page.getByRole("img", { name: "Album artwork" })).toBeVisible();
  await page.getByRole("button", { name: "Play audio", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "Pause audio", exact: true }).click();
  const position = page.getByRole("slider", { name: "Audio position" });
  await position.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0);
  await page.getByRole("combobox", { name: "Speed", exact: true }).selectOption("1.5");
  await page.getByRole("combobox", { name: "Repeat", exact: true }).selectOption("all");
  await page.getByRole("button", { name: "Shuffle", exact: true }).click();
  await page.getByText("Queue · 2 tracks", { exact: true }).click();
  await page.getByRole("button", { name: `Remove ${secondAudio} from queue`, exact: true }).click();
  await expect(page.getByText("Queue · 1 track", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Downloads", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Persistent audio player" });
  await expect(dock).toBeVisible();
  await tapVisibleTarget(dock.getByRole("button", { name: "Play audio", exact: true }));
  await expect(audio).toHaveJSProperty("paused", false);
  await tapVisibleTarget(dock.getByRole("button", { name: filenames[3], exact: true }));
  await expect(page.getByRole("tab", { name: "Explore", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("combobox", { name: "Repeat", exact: true })).toHaveValue("all");
  await expect(audio).toHaveJSProperty("playbackRate", 1.5);
  await expect(page.getByRole("button", { name: "Shuffle", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Queue · 1 track", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause audio", exact: true }).click();
  const audit = await new AxeBuilder({ page }).include(".audio-controls").analyze();
  expect(audit.violations).toEqual([]);
  if (browserName !== "webkit") {
    await page.getByRole("button", { name: "Maximize preview", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  }
  await page.getByRole("checkbox", { name: "Use browser audio controls" }).check();
  await expect(audio).toHaveJSProperty("controls", true);
  await expect(audio).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await expect(page.getByRole("button", { name: "Maximize preview", exact: true })).toBeDisabled();
  await expect(position).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Use browser audio controls" }).uncheck();
  await expect(position).toHaveCount(1);
});

test("starting video clears the paused audio dock and preserves it on return to Downloads", async ({
  page,
  appOrigin,
}) => {
  await openAudio(page, appOrigin);
  await setCssViewport(page, 844, 390);
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  const audio = page.getByLabel("Audio playback");
  await expect(audio).toHaveJSProperty("paused", false);
  await page.locator('label[for="workspace-pane-files"]').click();
  await page
    .getByRole("treeitem", {
      name: `${filenames[2]} ${filenames[2].split(".").at(-1)}`,
      exact: true,
    })
    .click();
  const video = page.getByLabel("Video preview");
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((element: HTMLVideoElement) => {
    element.muted = true;
  });
  await tapVisibleTarget(page.getByRole("button", { name: "Play video", exact: true }));
  await expect(audio).toHaveJSProperty("paused", true);
  const dock = page.getByRole("complementary", { name: "Persistent audio player" });
  await expect(dock).toBeHidden();
  await page.locator(".media-frame").scrollIntoViewIfNeeded();
  await expect(page.locator(".media-frame")).toBeInViewport({ ratio: 0.99 });
  await page.getByRole("tab", { name: "Downloads", exact: true }).click();
  await expect(dock).toBeVisible();
  await expect(audio).toHaveJSProperty("paused", true);
  await expect(audio).toHaveAttribute(
    "src",
    expect.stringContaining(encodeURIComponent(filenames[3])),
  );
  await dock.getByRole("checkbox", { name: "Use browser audio controls" }).check();
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await expect(audio).toBeHidden();
  await page.locator('label[for="workspace-pane-files"]').click();
  await expect(audio).toBeVisible();
  await page.getByRole("tab", { name: "Downloads", exact: true }).click();
  await expect(audio).toBeVisible();
});

test("finishing a track keeps an open slideshow and background playback", async ({
  page,
  appOrigin,
}) => {
  await openAudio(page, appOrigin);
  await page.getByText("Queue · 2 tracks", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: `Queue ${secondAudio}`, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await page
    .getByRole("treeitem", {
      name: `${filenames[0]} ${filenames[0].split(".").at(-1)}`,
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  const audio = page.getByLabel("Audio playback");
  await audio.evaluate((element: HTMLAudioElement) => {
    element.currentTime = element.duration - 0.2;
  });
  await expect.poll(() => audio.getAttribute("src")).toContain(encodeURIComponent(secondAudio));
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".preview-panel h2")).toHaveText(filenames[0]);
  await expect(page.getByRole("complementary", { name: "Persistent audio player" })).toBeVisible();
});

test("a real decode failure offers retry and original download without auto-skipping", async ({
  page,
  appOrigin,
}) => {
  const invalidAudio = "invalid-audio.wav";
  await installAudioReviewFixtures(page, invalidAudio);
  await serveRealAudio(page);
  await page.goto(appOrigin);
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
  await page
    .getByRole("treeitem", {
      name: `${invalidAudio} ${invalidAudio.split(".").at(-1)}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("alert")).toContainText("could not be loaded or decoded");
  await expect(page.getByRole("link", { name: "Download original audio" })).toHaveAttribute(
    "href",
    expect.stringContaining(invalidAudio),
  );
  await expect(page.getByLabel("Audio playback")).toHaveJSProperty("paused", true);
  await expect(page.locator(".preview-panel h2")).toHaveText(invalidAudio);
});

test("touch controls and recovery remain usable across narrow, landscape and desktop layouts", async ({
  page,
  appOrigin,
}) => {
  await openAudio(page, appOrigin);
  for (const [width, height] of [
    [320, 640],
    [360, 740],
    [820, 900],
    [844, 390],
    [1440, 900],
  ]) {
    await setCssViewport(page, width, height);
    if (width <= 760 || height <= 500)
      await page.locator('label[for="workspace-pane-preview"]').click();
    await tapVisibleTarget(page.getByRole("button", { name: "Mute audio", exact: true }));
    await expect(page.getByRole("button", { name: "Unmute audio", exact: true })).toBeVisible();
    await tapVisibleTarget(page.getByRole("button", { name: "Unmute audio", exact: true }));
    await page.getByRole("slider", { name: "Audio position" }).focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() =>
        page.getByLabel("Audio playback").evaluate((audio: HTMLAudioElement) => audio.currentTime),
      )
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  }
  await page
    .getByLabel("Audio playback")
    .evaluate((audio: HTMLAudioElement) => audio.dispatchEvent(new Event("error")));
  await expect(page.getByRole("alert")).toContainText("download the original");
  await expect(page.getByRole("link", { name: "Download original audio" })).toBeVisible();
  await tapVisibleTarget(page.getByRole("button", { name: "Retry audio", exact: true }));
  await expect(page.getByRole("alert")).toHaveCount(0);
});
