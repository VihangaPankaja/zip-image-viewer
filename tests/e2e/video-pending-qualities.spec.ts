import { expect } from "@playwright/test";
import { test } from "./media-fixture";
import { filenames, installReviewFixtures } from "../review/fixtures";

test("clears the playing video until the next file's qualities resolve", async ({
  page,
  appOrigin,
}) => {
  test.setTimeout(60_000);
  await installReviewFixtures(page);
  await page.route("**/api/sessions/*/video/play?*", (route) =>
    route.continue(),
  );
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let probing = false;
  await page.route("**/rpc/video/qualities", async (route) => {
    const payload = route.request().postDataJSON() as {
      json: { path: string };
    };
    if (payload.json.path === filenames[5]) {
      probing = true;
      await pending;
    }
    await route.fallback();
  });
  try {
    await page.goto(appOrigin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Open Coastal collection" }).click();
    await page
      .getByRole("treeitem", { name: filenames[2], exact: true })
      .click();
    const video = page.getByLabel("Video preview");
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.25);
    await page
      .getByRole("treeitem", { name: filenames[5], exact: true })
      .click();
    await expect.poll(() => probing).toBe(true);
    await expect(page.locator(".preview-panel h2")).toHaveText(filenames[5]);
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => ({
          paused: element.paused,
          src: element.getAttribute("src"),
          readyState: element.readyState,
          sources: element.querySelectorAll("source").length,
        })),
      )
      .toEqual({ paused: true, src: null, readyState: 0, sources: 0 });
    release();
    await expect(page.getByText("Mode: Remux", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      await video.evaluate((element: HTMLVideoElement) =>
        new URL(element.currentSrc).searchParams.get("path"),
      ),
    ).toBe(filenames[5]);
    await video.evaluate(async (element: HTMLVideoElement) => {
      await element.play();
    });
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.25);
    await page.route("**/rpc/video/qualities", (route) =>
      route.fulfill({ status: 500, json: { error: "Probe failed" } }),
    );
    await page
      .getByRole("treeitem", { name: filenames[2], exact: true })
      .click();
    await expect(
      page.getByText("Mode: Original file", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await video.evaluate(async (element: HTMLVideoElement) => {
      await element.play();
    });
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0.25);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
