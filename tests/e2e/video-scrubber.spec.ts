import { expect, test } from "@playwright/test";
import {
  filenames,
  installReviewFixtures,
  prepareMedia,
} from "../review/fixtures";

test.use({ hasTouch: true });

test("real video previews pointer, keyboard and touch seeks before committing", async ({
  page,
  browserName,
  context,
}) => {
  test.skip(
    browserName !== "chromium",
    "Native touch drag uses Chromium CDP; other browser suites exercise the app separately.",
  );
  test.setTimeout(90_000);
  await prepareMedia();
  await installReviewFixtures(page);
  const thumbnailTimes: number[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/video/thumbnail"))
      thumbnailTimes.push(Number(url.searchParams.get("time")));
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  await page
    .getByRole("button", { name: "Open Coastal collection", exact: true })
    .click();
  await page.getByRole("treeitem", { name: filenames[2], exact: true }).click();
  const video = page.getByLabel("Video preview");
  const seek = page.getByRole("slider", { name: "Seek video" });
  const thumbnail = page.locator(".video-scrubber-preview img");
  await expect(seek).toHaveAttribute("max", "8");
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(3);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  expect(thumbnailTimes).toEqual([]);
  await expect(thumbnail).toHaveCount(0);
  const before = await video.evaluate(
    (element: HTMLVideoElement) => element.currentTime,
  );
  await seek.scrollIntoViewIfNeeded();
  const box = await seek.boundingBox();
  if (!box) throw new Error("Seek control is missing");
  await page.mouse.move(
    box.x + (box.width * before) / 8,
    box.y + box.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.92, box.y + box.height / 2, {
    steps: 8,
  });
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveJSProperty("naturalWidth", 320);
  await expect(video).toHaveJSProperty("currentTime", before);
  const pointerTime = Number(await seek.inputValue());
  expect(pointerTime).toBeGreaterThan(7);
  await page.mouse.move(box.x + box.width * 0.92, box.y - 30);
  await page.mouse.up();
  await expect(video).toHaveJSProperty("currentTime", pointerTime);
  await expect(thumbnail).toHaveCount(0);

  await seek.focus();
  await page.keyboard.down("Home");
  await expect(seek).toHaveValue("0");
  await expect(video).toHaveJSProperty("currentTime", pointerTime);
  await page.keyboard.up("Home");
  await expect(video).toHaveJSProperty("currentTime", 0);
  await page.keyboard.down("End");
  await expect(seek).toHaveValue("8");
  await expect(thumbnail).toHaveJSProperty("naturalWidth", 320);
  await expect(video).toHaveJSProperty("currentTime", 0);
  expect(thumbnailTimes.every((time) => time >= 0 && time < 8)).toBe(true);
  await page.keyboard.up("End");
  await expect(video).toHaveJSProperty("currentTime", 8);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.ended))
    .toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("radio", { name: "Preview", exact: true })
    .check({ force: true });
  await seek.scrollIntoViewIfNeeded();
  const touchBox = await seek.boundingBox();
  if (!touchBox) throw new Error("Mobile seek control is missing");
  const client = await context.newCDPSession(page);
  const y = touchBox.y + touchBox.height / 2;
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchBox.x + touchBox.width - 8, y }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: touchBox.x + touchBox.width * 0.6, y }],
  });
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveJSProperty("naturalWidth", 320);
  await expect(video).toHaveJSProperty("currentTime", 8);
  const touchTime = Number(await seek.inputValue());
  expect(touchTime).toBeGreaterThan(4);
  expect(touchTime).toBeLessThan(6);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(video).toHaveJSProperty("currentTime", touchTime);
  await expect(thumbnail).toHaveCount(0);
  await video.evaluate(async (element: HTMLVideoElement) => {
    await element.play();
  });
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(touchTime + 0.3);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await client.detach();
});
