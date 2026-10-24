import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tapVisibleTarget } from "./touch";
import { installReviewFixtures, prepareMedia } from "../review/fixtures";
import { setCssViewport } from "./helpers/viewport";

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
}

test("tablet video actions remain clickable above the player", async ({ page }) => {
  await setCssViewport(page, 820, 1180);
  await prepareMedia();
  await installReviewFixtures(page);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Open Coastal collection", exact: true }).click();
    await page.getByRole("treeitem", { name: "06-film.mkv", exact: true }).click();
    await expect(page.getByText("Mode: Remux", { exact: true })).toBeVisible();
    const fallback = page.getByRole("button", { name: "Transcode instead", exact: true });
    await fallback.scrollIntoViewIfNeeded();
    expect(
      await fallback.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        return button.contains(
          document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
        );
      }),
    ).toBe(true);
    await fallback.click();
    await expect(page.getByText("Mode: Transcode", { exact: true })).toBeVisible();
  }
});

for (const { width, hasTouch } of [
  { width: 761, hasTouch: false },
  { width: 820, hasTouch: false },
  { width: 1100, hasTouch: false },
  { width: 1440, hasTouch: false },
  { width: 820, hasTouch: true },
]) {
  test(`explorer fits below the header at ${width}px with ${hasTouch ? "touch" : "pointer"}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      hasTouch,
    });
    const page = await context.newPage();
    await setCssViewport(page, width, 1000);
    await installReviewFixtures(page);
    await page.route("**/api/sessions/*/file?*", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="teal"/></svg>',
      }),
    );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto("http://127.0.0.1:5173/");
      await page.getByRole("tab", { name: "Explore" }).click();
      await page.getByRole("button", { name: "Open Coastal collection", exact: true }).click();
      await page.getByRole("treeitem").filter({ hasText: "01-coast.png" }).click();
      await expect(page.locator(".image-frame img")).toBeVisible();
      const panels = page.locator(".workspace-panel-group");
      await expect(panels).toBeVisible();
      const layout = await panels.evaluate((element) => ({
        bottom: element.getBoundingClientRect().bottom,
        viewport: innerHeight,
        pageHeight: document.documentElement.scrollHeight,
      }));
      expect(layout.pageHeight).toBeLessThanOrEqual(layout.viewport + 1);
      expect(Math.round(layout.bottom)).toBeLessThanOrEqual(layout.viewport);
    }
    await context.close();
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`native ${theme} choice keeps keyboard focus visible`, async ({ page }) => {
    await setCssViewport(page, 390, 844);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await installReviewFixtures(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const sort = page.getByRole("combobox", { name: "Default sort", exact: true });
    await sort.scrollIntoViewIfNeeded();
    await sort.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(sort).not.toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(sort).toBeFocused();
    await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
    await page.screenshot({ animations: "disabled" });
    expect(
      await sort.evaluate((element) => {
        const header = element.closest("dialog")?.querySelector(".panel-header");
        if (!header) throw new Error("Settings header is missing.");
        return element.getBoundingClientRect().top >= header.getBoundingClientRect().bottom + 4;
      }),
    ).toBe(true);
  });
}

for (const width of [360, 390, 820, 1440, 2560]) {
  test(`compact settings and menus fit at ${width}px`, async ({ page }, testInfo) => {
    await setCssViewport(page, width, 1000);
    await page.goto("/");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const select = page.getByRole("combobox", { name: "Default sort", exact: true });
      await select.focus();
      await page.keyboard.press("ArrowDown");
      await expect(select).toBeFocused();
      await select.selectOption({ label: "Name A-Z" });
      await expect(select).toHaveValue("name-asc");
      await page.screenshot({ path: testInfo.outputPath(`menu-${theme}.png`) });
      await page.keyboard.press("Tab");
      await expect(select).not.toBeFocused();
      await expect(select).toHaveValue("name-asc");
      await fits(page);
      expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
      await page.getByRole("button", { name: "Close", exact: true }).click();
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
  await setCssViewport(page, 360, 900);
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
    page.getByRole("combobox", { name: "Default sort", exact: true }),
    page.locator(".toggle-row").first(),
    page.locator(".theme-option").first(),
  ]) {
    await locator.scrollIntoViewIfNeeded();
    expect(Math.round((await locator.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(44);
  }
  const sort = page.getByRole("combobox", { name: "Default sort", exact: true });
  await tapVisibleTarget(sort);
  await sort.selectOption({ label: "Name A-Z" });
  await expect(sort).toHaveValue("name-asc");
  await fits(page);
  await context.close();
});

test("compact fields and browser-zoom breakpoints use the shared sizes", async ({ page }) => {
  await setCssViewport(page, 1440, 1000);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const fieldSize = await page.evaluate(() =>
    matchMedia("(any-pointer: coarse)").matches ? "16px" : "14px",
  );
  await expect(page.getByLabel("Concurrent downloads")).toHaveCSS("font-size", fieldSize);
  await page.keyboard.press("Escape");
  // A 1440px window at 200% browser zoom has a 720px CSS viewport.
  await setCssViewport(page, 720, 500);
  expect(await page.evaluate(() => matchMedia("(width <= 760px)").matches)).toBe(true);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCSS(
    "min-height",
    "44px",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await fits(page);
});

test("slideshow reveal remains a full touch target with hidden controls", async ({ page }) => {
  await setCssViewport(page, 360, 900);
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
  await setCssViewport(page, 1440, 1000);
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".theme-option")
    .first()
    .evaluate((element) => element.append(" with a longer translated label"));
  const sort = page.getByRole("combobox", { name: "Default sort", exact: true });
  const label = "A long sorting option that must remain readable and selectable";
  await sort.locator("option:checked").evaluate((element, text) => {
    element.textContent = text;
  }, label);
  await expect(sort.locator("option:checked")).toHaveText(label);
  await fits(page);
  await page.getByLabel("Seek jump seconds").scrollIntoViewIfNeeded();
  await expect(page.getByLabel("Seek jump seconds")).toBeInViewport();
});
