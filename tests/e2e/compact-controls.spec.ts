import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tapVisibleTarget } from "./touch";
import { installReviewFixtures } from "../review/fixtures";

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
}

for (const width of [360, 390, 820, 1440, 2560]) {
  test(`compact settings and menus fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const trigger = page.getByRole("button", { name: "Default sort", exact: true });
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("listbox").getByRole("option", { selected: true })).toBeFocused();
      await page.keyboard.press("End");
      await expect(page.getByRole("listbox").getByRole("option").last()).toBeFocused();
      await page.keyboard.press("Home");
      await expect(page.getByRole("listbox").getByRole("option").first()).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath(`menu-${theme}.png`) });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
      await page.keyboard.press("Enter");
      await page.keyboard.press("n");
      await page.keyboard.press("Enter");
      await expect(trigger).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Tab");
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(trigger).not.toBeFocused();
      await fits(page);
      expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
    }
  });
}

test("touch targets remain 44px and native controls support loading and errors", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    viewport: { width: 360, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();
  let failSave: (() => Promise<void>) | undefined;
  await page.route("**/rpc/scheduler/update", async (route) => {
    await new Promise<void>((resolve) => {
      failSave = async () => {
        await route.fulfill({ status: 500, body: "Unavailable" });
        resolve();
      };
    });
  });
  await page.goto("http://127.0.0.1:5173/");
  await tapVisibleTarget(page.getByRole("button", { name: "Settings", exact: true }));
  const concurrency = page.getByLabel("Concurrent downloads");
  await expect(concurrency).toHaveCSS("font-size", "16px");
  await concurrency.selectOption("3");
  await expect(concurrency).toBeDisabled();
  await expect.poll(() => Boolean(failSave)).toBe(true);
  await failSave?.();
  await expect(concurrency).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("Could not update concurrent downloads");
  for (const locator of [
    concurrency,
    page.getByRole("button", { name: "Default sort", exact: true }),
    page.locator(".toggle-row").first(),
    page.locator(".theme-option").first(),
  ]) {
    await locator.scrollIntoViewIfNeeded();
    expect(Math.round((await locator.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(44);
  }
  await tapVisibleTarget(page.getByRole("button", { name: "Default sort", exact: true }));
  await tapVisibleTarget(
    page.getByRole("listbox").getByRole("option", { name: "Name A-Z", exact: true }),
  );
  await fits(page);
  await context.close();
});

test("compact fields and browser-zoom breakpoints use the shared sizes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Concurrent downloads")).toHaveCSS("font-size", "14px");
  await page.keyboard.press("Escape");
  // A 1440px window at 200% browser zoom has a 720px CSS viewport.
  await page.setViewportSize({ width: 720, height: 500 });
  expect(await page.evaluate(() => matchMedia("(width <= 760px)").matches)).toBe(true);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCSS(
    "min-height",
    "44px",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await fits(page);
});

test("slideshow reveal remains a full touch target with hidden controls", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await installReviewFixtures(page);
  await page.route("**/api/sessions/*/file?*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="teal"/></svg>',
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  await page.getByRole("button", { name: "Show sessions" }).click();
  await page.getByRole("button", { name: "Open Coastal collection", exact: true }).click();
  await page.getByRole("button", { name: "Hide sessions" }).click();
  await page.getByRole("treeitem").filter({ hasText: "01-coast.png" }).click();
  await page.getByRole("radio", { name: "Preview", exact: true }).check({ force: true });
  await page.getByRole("button", { name: "Slideshow", exact: true }).click();
  await page.getByRole("button", { name: "Hide UI", exact: true }).click();
  const reveal = page.getByRole("button", { name: "Show UI", exact: true });
  expect(Math.round((await reveal.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(44);
  await reveal.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Hide UI", exact: true })).toBeVisible();
});

test("long labels and fields reflow at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".theme-option")
    .first()
    .evaluate((element) => element.append(" with a longer translated label"));
  await page.getByRole("button", { name: "Default sort", exact: true }).click();
  await page
    .getByRole("listbox")
    .getByRole("option")
    .first()
    .evaluate((element) => {
      element.textContent = "A long sorting option that must wrap and remain selectable";
    });
  expect(
    await page
      .getByRole("listbox")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await page.getByRole("listbox").getByRole("option").first().click();
  await fits(page);
  await page.getByLabel("Seek jump seconds").scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Seek jump seconds")).toBeInViewport();
});
