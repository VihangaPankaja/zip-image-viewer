import { expect } from "@playwright/test";
import { test } from "./media-fixture";
import { tapVisibleTarget } from "./touch";
import {
  filenames,
  installReviewFixtures,
  reviewSubtitles,
} from "../review/fixtures";

test.use({ hasTouch: true });

test("local SRT and WebVTT captions render, shift, resize and recover at 360px", async ({
  page,
  browserName,
  appOrigin,
}) => {
  test.setTimeout(90_000);
  await installReviewFixtures(page);
  await page.route("**/api/sessions/*/video/play?*", (route) =>
    route.continue(),
  );
  await page.setViewportSize({ width: 360, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(appOrigin);
  await page.getByRole("tab", { name: "Explore" }).click();
  await page.getByRole("button", { name: "Show sessions" }).click();
  await page
    .getByRole("button", { name: "Open Coastal collection", exact: true })
    .click();
  await page.getByRole("treeitem", { name: filenames[2], exact: true }).click();
  const video = page.getByLabel("Video preview");
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
    element.pause();
  });
  const upload = page.getByLabel("Subtitle file", { exact: true });
  const load = page.getByRole("button", {
    name: "Load subtitles",
    exact: true,
  });
  const chooser = page.waitForEvent("filechooser");
  await load.focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(reviewSubtitles);
  await expect(page.getByText(reviewSubtitles.name)).toBeVisible();
  const captions = page.getByRole("button", { name: "Captions", exact: true });
  await expect(captions).toHaveAttribute("aria-pressed", "true");
  const activeText = () =>
    video.evaluate((element: HTMLVideoElement) =>
      Array.from(element.textTracks)
        .filter((track) => track.mode === "showing")
        .flatMap((track) =>
          Array.from(track.activeCues ?? []).map((cue) => (cue as VTTCue).text),
        ),
    );
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 2;
  });
  await expect.poll(activeText).toEqual(["Morning light along the coast"]);
  const offset = page.getByRole("spinbutton", {
    name: "Caption offset (seconds)",
  });
  await offset.fill("2");
  await offset.press("Tab");
  await expect.poll(activeText).toEqual([]);
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 4;
  });
  await expect.poll(activeText).toEqual(["Morning light along the coast"]);
  await page
    .getByRole("combobox", { name: "Caption size" })
    .selectOption("large");
  await expect(
    page.getByRole("combobox", { name: "Caption size" }),
  ).toHaveValue("large");
  await expect(video).toHaveAttribute("data-caption-size", "large");
  await tapVisibleTarget(captions);
  await expect(captions).toHaveAttribute("aria-pressed", "false");
  await expect.poll(activeText).toEqual([]);
  await captions.focus();
  await page.keyboard.press("Enter");
  await expect.poll(activeText).toEqual(["Morning light along the coast"]);
  await upload.setInputFiles({
    name: "broken.srt",
    mimeType: "text/plain",
    buffer: Buffer.from("1\nnot a timestamp\nInvalid subtitle"),
  });
  await expect(page.getByRole("alert")).toBeVisible();
  await upload.setInputFiles({
    name: "Recovered.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(
      "WEBVTT\n\n00:00:00.000 --> 00:00:07.500\nRecovered coastal captions\n",
    ),
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await offset.fill("0");
  await offset.press("Tab");
  await expect.poll(activeText).toEqual(["Recovered coastal captions"]);
  if (browserName === "chromium") {
    await video.evaluate((element: HTMLVideoElement) =>
      element.requestFullscreen(),
    );
    await expect
      .poll(() =>
        video.evaluate((element) => document.fullscreenElement === element),
      )
      .toBe(true);
    await expect.poll(activeText).toEqual(["Recovered coastal captions"]);
    await page.evaluate(() => document.exitFullscreen());
  }
  await tapVisibleTarget(
    page.getByRole("button", { name: "Remove subtitles" }),
  );
  await expect.poll(activeText).toEqual([]);
  await upload.setInputFiles(reviewSubtitles);
  await tapVisibleTarget(page.locator('label[for="workspace-pane-files"]'));
  await page.getByRole("treeitem", { name: filenames[1], exact: true }).click();
  await tapVisibleTarget(page.locator('label[for="workspace-pane-files"]'));
  await page.getByRole("treeitem", { name: filenames[2], exact: true }).click();
  await expect(page.getByText(reviewSubtitles.name)).toHaveCount(0);
  expect(
    await video.evaluate((element: HTMLVideoElement) =>
      Array.from(element.textTracks).some((track) => track.mode === "showing"),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
