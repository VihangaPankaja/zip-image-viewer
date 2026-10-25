import { expect, test } from "@playwright/test";
import { startMultilingualFixture } from "../fixtures/multilingual";
import { tapVisibleTarget } from "./touch";
import { test as mediaTest } from "./media-fixture";
import { filenames, installReviewFixtures } from "../review/fixtures";

test.use({ hasTouch: true });

test("real multilingual audio switches in sync and embedded captions recover on desktop and mobile", async ({
  page,
  baseURL,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Real multi-track HLS decoding runs in Chromium; native audio selection has hook coverage.",
  );
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("App URL is required.");
  const fixture = await startMultilingualFixture(baseURL);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(fixture.origin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Open multilingual.mkv" }).click();
    const video = page.getByLabel("Video preview");
    await page.getByText("Video settings", { exact: true }).click();
    const audio = page.getByRole("combobox", { name: "Audio language" });
    await expect(audio).toBeVisible();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(2);
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(1);
    // A progressive EVENT playlist initially exposes only its first segment.
    // Wait until the requested seek is available instead of seeking past its end.
    await expect
      .poll(
        () =>
          video.evaluate(
            (element: HTMLVideoElement) =>
              element.seekable.length > 0 && element.seekable.end(element.seekable.length - 1) > 5,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    await video.evaluate((element: HTMLVideoElement) => {
      element.pause();
      element.currentTime = 5;
    });
    await expect
      .poll(
        () =>
          video.evaluate(
            (element: HTMLVideoElement) =>
              !element.seeking &&
              element.readyState >= 2 &&
              Math.abs(element.currentTime - 5) < 0.1,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    const originalSource = await video.evaluate((element: HTMLVideoElement) => element.currentSrc);
    await audio.selectOption({ label: "Spanish" });
    await expect(audio).toHaveValue("1");
    await expect
      .poll(() => fixture.requests.some((url) => url.includes("quality=audio-2")))
      .toBe(true);
    await expect(video).toHaveJSProperty("paused", true);
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(
      5,
      0,
    );
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentSrc)).toBe(
      originalSource,
    );
    const subtitles = page.getByRole("combobox", {
      name: "Embedded subtitles",
    });
    await subtitles.selectOption({ label: "Spanish captions" });
    const activeText = () =>
      video.evaluate((element: HTMLVideoElement) =>
        Array.from(element.textTracks)
          .filter((track) => track.mode === "showing")
          .flatMap((track) =>
            Array.from(track.activeCues ?? []).map((cue) => (cue as VTTCue).text),
          ),
      );
    await expect.poll(activeText).toEqual(["Subtítulos de la costa"]);
    await page.screenshot({
      path: testInfo.outputPath("spanish-audio-captions.png"),
    });
    await video.evaluate(async (element: HTMLVideoElement) => {
      await element.play();
    });
    await audio.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(audio).toHaveValue("0");
    await expect
      .poll(() => fixture.requests.some((url) => url.includes("quality=audio-1")))
      .toBe(true);
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(5.25);
    await expect(video).toHaveJSProperty("paused", false);
    await expect.poll(activeText).toEqual(["Subtítulos de la costa"]);
    await video.evaluate((element: HTMLVideoElement) => element.pause());
    await page.setViewportSize({ width: 360, height: 844 });
    await page.locator('label[for="workspace-pane-preview"]').click();
    await tapVisibleTarget(audio);
    await audio.selectOption({ label: "Spanish" });
    await subtitles.selectOption({ label: "English captions" });
    await expect.poll(activeText).toEqual(["English coastal captions"]);
    await page.getByLabel("Subtitle file", { exact: true }).setInputFiles({
      name: "broken.srt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a subtitle"),
    });
    await expect(page.getByRole("alert")).toBeVisible();
    await subtitles.selectOption({ label: "Spanish captions" });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect.poll(activeText).toEqual(["Subtítulos de la costa"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: testInfo.outputPath("mobile-recovered-language.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

mediaTest(
  "embedded subtitle choices render native captions and recover across browsers at 360px",
  async ({ page, appOrigin }) => {
    await installReviewFixtures(page);
    await page.route("**/api/sessions/*/video/play?*", (route) => route.continue());
    await page.route("**/rpc/video/qualities", (route) =>
      route.fulfill({
        json: {
          json: {
            path: filenames[2],
            source: { width: 960, height: 540, durationSeconds: 8 },
            options: [
              { id: "source", label: "Direct play", height: 540 },
              { id: "auto", label: "Auto", height: null },
            ],
            defaultQuality: "source",
            subtitleTracks: [
              {
                id: "subtitle-3",
                index: 3,
                language: "eng",
                label: "English captions",
                isDefault: false,
              },
              {
                id: "subtitle-4",
                index: 4,
                language: "spa",
                label: "Spanish captions",
                isDefault: false,
              },
            ],
          },
        },
      }),
    );
    let rejectCaptions = false;
    await page.route("**/api/sessions/*/video/subtitles?*", (route) => {
      if (rejectCaptions)
        return route.fulfill({
          status: 422,
          json: { error: "Subtitle conversion failed." },
        });
      const spanish = new URL(route.request().url()).searchParams.get("track") === "subtitle-4";
      return route.fulfill({
        contentType: "text/vtt",
        body: `WEBVTT\n\n00:00:00.000 --> 00:00:07.500\n${spanish ? "Subtítulos de la costa" : "English coastal captions"}\n`,
      });
    });
    await page.setViewportSize({ width: 360, height: 844 });
    await page.goto(appOrigin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Show sessions" }).click();
    await page.getByRole("button", { name: "Open Coastal collection", exact: true }).click();
    await page.getByRole("treeitem", { name: filenames[2], exact: true }).click();
    const video = page.getByLabel("Video preview");
    await page.getByText("Video settings", { exact: true }).click();
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
      element.pause();
      element.currentTime = 2;
    });
    const picker = page.getByRole("combobox", { name: "Embedded subtitles" });
    const activeText = () =>
      video.evaluate((element: HTMLVideoElement) =>
        Array.from(element.textTracks)
          .filter((track) => track.mode === "showing")
          .flatMap((track) =>
            Array.from(track.activeCues ?? []).map((cue) => (cue as VTTCue).text),
          ),
      );
    await picker.selectOption({ label: "Spanish captions" });
    await expect.poll(activeText).toEqual(["Subtítulos de la costa"]);
    const captions = page.getByRole("button", {
      name: "Captions",
      exact: true,
    });
    await tapVisibleTarget(captions);
    await expect.poll(activeText).toEqual([]);
    await captions.focus();
    await page.keyboard.press("Enter");
    await expect.poll(activeText).toEqual(["Subtítulos de la costa"]);
    await picker.selectOption("");
    await expect.poll(activeText).toEqual([]);
    rejectCaptions = true;
    await picker.selectOption({ label: "English captions" });
    await expect(page.getByRole("alert")).toBeVisible();
    rejectCaptions = false;
    await picker.selectOption({ label: "English captions" });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect.poll(activeText).toEqual(["English coastal captions"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  },
);
