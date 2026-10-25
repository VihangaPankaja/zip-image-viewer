import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { test } from "./media-fixture";
import { installReviewFixtures, reviewJobs } from "../review/fixtures";
import { tapVisibleTarget } from "./touch";

test("storage supports narrow-screen keyboard cleanup, pinning and deliberate deletion", async ({
  page,
  appOrigin,
}) => {
  const state = await installReviewFixtures(page);
  state.jobs = reviewJobs();
  const releases: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE" && request.url().includes("/api/session-jobs/"))
      releases.push(request.url());
  });
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto(appOrigin);
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page.getByRole("button", { name: "Show sessions" }).click();
  await page.getByRole("button", { name: "Open Coastal collection", exact: true }).click();
  const storage = page.getByRole("button", { name: "Storage", exact: true });
  await storage.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Session storage" });
  await expect(dialog).toContainText("50 MB");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("checkbox", { name: "Keep until the server stops" }).focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("status")).toHaveText("Session kept until the server stops.");
  expect(state.storage.pinned).toBe(true);
  await dialog.getByRole("button", { name: "Clear preview & transcode cache" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Cache cleared. Original files kept.");
  expect(state.storage.originalsBytes).toBe(52428800);
  await expect(dialog.locator("dd")).toHaveText(["50 MB", "0 B", "0 B"]);
  const results = await new AxeBuilder({ page }).include(".storage-dialog").analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(storage).toBeFocused();
  state.storage.retained = true;
  await storage.click();
  await dialog.getByRole("button", { name: "Delete session files…" }).click();
  await expect(dialog).toContainText("source data needed to resume later");
  await dialog.getByRole("button", { name: "Keep files" }).click();
  await expect(dialog.getByRole("button", { name: "Delete permanently" })).toHaveCount(0);
  let deleted = false;
  let blocked = true;
  await page.route("**/rpc/sessions/remove", (route) => {
    if (blocked)
      return route.fulfill({
        status: 409,
        json: {
          json: {
            defined: false,
            code: "CONFLICT",
            status: 409,
            message:
              "Pause or cancel the download and wait for it to stop before deleting its files.",
          },
        },
      });
    deleted = true;
    return route.fulfill({ json: { json: null } });
  });
  await dialog.getByRole("button", { name: "Delete session files…" }).click();
  expect(deleted).toBe(false);
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Pause or cancel the download");
  await expect(dialog.getByRole("button", { name: "Keep files" })).toBeEnabled();
  expect(deleted).toBe(false);
  blocked = false;
  await dialog.getByRole("button", { name: "Delete permanently" }).click();
  await expect(dialog).toHaveCount(0);
  expect(deleted).toBe(true);
  await expect(page.locator(".preview-panel")).toContainText("Select a file");
  await expect(storage).toHaveCount(0);
  await page.getByRole("tab", { name: "Downloads", exact: true }).click();
  await expect(page.getByText("Downloading collection", { exact: true })).toBeVisible();
  expect(releases).toEqual([]);
});

test("touch dismissal returns focus and a cleanup conflict keeps storage usable", async ({
  browser,
  appOrigin,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await installReviewFixtures(page);
    await page.goto(appOrigin);
    await tapVisibleTarget(page.getByRole("tab", { name: "Explore", exact: true }));
    await tapVisibleTarget(page.getByRole("button", { name: "Show sessions" }));
    await tapVisibleTarget(
      page.getByRole("button", {
        name: "Open Coastal collection",
        exact: true,
      }),
    );
    const storage = page.getByRole("button", { name: "Storage", exact: true });
    await tapVisibleTarget(storage);
    const dialog = page.getByRole("dialog", { name: "Session storage" });
    await expect(dialog).toContainText("50 MB");
    await page.route("**/rpc/storage/clear", (route) =>
      route.fulfill({
        status: 409,
        json: {
          json: {
            defined: false,
            code: "CONFLICT",
            status: 409,
            message:
              "Media is active. Close playback and wait 30 seconds before clearing the cache.",
          },
        },
      }),
    );
    await tapVisibleTarget(dialog.getByRole("button", { name: "Clear preview & transcode cache" }));
    await expect(dialog.getByRole("alert")).toContainText("Media is active");
    await expect(dialog.locator("dd")).toHaveText(["50 MB", "2.0 MB", "12 MB"]);
    await tapVisibleTarget(dialog.getByRole("button", { name: "Close", exact: true }));
    await expect(dialog).toHaveCount(0);
    await expect(storage).toBeFocused();
  } finally {
    await context.close();
  }
});
