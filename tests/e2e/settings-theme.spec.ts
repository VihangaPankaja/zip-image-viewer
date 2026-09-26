import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const overflowing = await page.evaluate(() => {
    if (document.documentElement.scrollWidth <= window.innerWidth + 1)
      return [];
    return Array.from(document.querySelectorAll("body *"))
      .map((element) => ({
        tag: element.tagName,
        className: element.getAttribute("class"),
        right: element.getBoundingClientRect().right,
      }))
      .filter(({ right }) => right > window.innerWidth + 1);
  });
  expect(overflowing).toEqual([]);
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible()) {
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
  }
}

for (const width of [320, 375, 768, 1440]) {
  test(`settings and workspaces remain usable at ${String(width)}px in both themes`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByLabel("Concurrent downloads")).toHaveCount(0);

    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("body")).toHaveCSS(
        "color",
        theme === "light" ? "rgb(25, 44, 56)" : "rgb(240, 245, 248)",
      );
      await expect(
        page.getByRole("heading", { name: "Transfer desk" }),
      ).toHaveCSS(
        "color",
        theme === "light" ? "rgb(25, 44, 56)" : "rgb(240, 245, 248)",
      );
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`downloads-${theme}.png`),
        animations: "disabled",
      });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "Settings",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("radio", { name: "System", exact: true }),
      ).toBeChecked();
      await page.screenshot({
        path: testInfo.outputPath(`settings-${theme}.png`),
        animations: "disabled",
      });
      for (const control of [
        dialog.getByLabel("Concurrent downloads"),
        dialog.getByRole("button", { name: "Default sort", exact: true }),
        dialog.getByLabel("Seek jump seconds"),
        dialog.getByLabel("Show Path column"),
      ]) {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport();
        const bounds = await control.boundingBox();
        expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect(
          (bounds?.x ?? 0) + (bounds?.width ?? Infinity),
        ).toBeLessThanOrEqual(width);
      }
      await expectNoHorizontalOverflow(page);
      expect(
        (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
      ).toEqual([]);
      await dialog
        .getByRole("button", { name: "Close", exact: true })
        .scrollIntoViewIfNeeded();

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Settings", exact: true }),
      ).toBeFocused();
    }

    await page.getByRole("tab", { name: "Explore" }).click();
    await expect(
      page.getByRole("button", { name: "Sort", exact: true }),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("explore.png"),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Add downloads", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Paste download URLs" })
      .fill(`https://example.com/${"long-archive-title-".repeat(30)}.zip`);
    await page
      .getByRole("heading", { name: "Add downloads", exact: true })
      .click();
    await expect(page.getByLabel("Download URL", { exact: true })).toHaveCount(
      1,
    );
    await expectNoHorizontalOverflow(page);
    await expect(
      page.getByRole("button", { name: "Add to queue" }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("composer.png"),
      animations: "disabled",
    });
  });
}

test("theme override and settings persist while dialogs contain keyboard focus", async ({
  page,
}) => {
  let maxConcurrent = 2;
  await page.route("**/rpc/scheduler/get", (route) =>
    route.fulfill({ json: { json: { maxConcurrent } } }),
  );
  await page.route("**/rpc/scheduler/update", async (route) => {
    const body = route.request().postDataJSON() as {
      json: { maxConcurrent: number };
    };
    maxConcurrent = body.json.maxConcurrent;
    await route.fulfill({ json: { json: { maxConcurrent } } });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByText("Light", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await dialog.getByLabel("Concurrent downloads").selectOption("4");
  await expect.poll(() => maxConcurrent).toBe(4);
  await dialog
    .getByRole("button", { name: "Default sort", exact: true })
    .click();
  await page.getByRole("option", { name: "Name A-Z", exact: true }).click();
  await dialog.getByLabel("Seek jump seconds").fill("9");
  await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Settings", exact: true }),
  ).toBeFocused();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    dialog.getByRole("radio", { name: "Light", exact: true }),
  ).toBeChecked();
  await expect(dialog.getByLabel("Concurrent downloads")).toHaveValue("4");
  await expect(
    dialog.getByRole("button", { name: "Default sort", exact: true }),
  ).toHaveText("Name A-Z");
  await expect(dialog.getByLabel("Seek jump seconds")).toHaveValue("9");
  await dialog.getByText("Dark", { exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("radio", { name: "System", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("long transfer names, statistics, and actions fit in both themes", async ({
  page,
}, testInfo) => {
  const items = ["running", "awaiting_confirmation", "error"].map(
    (status, index) => ({
      id: `00000000-0000-4000-8000-00000000000${String(index + 1)}`,
      url: `https://downloads.example.com/${"archive-with-a-long-name-".repeat(12)}${String(index)}.zip`,
      sourceKind: "http",
      sourcePreference: "auto",
      status,
      phase: "download",
      percent: index === 0 ? 42 : null,
      queuePosition: index,
      canPause: index === 0,
      requiresConfirmation: index === 1,
      message:
        index === 2
          ? "The server stopped responding. Retry to continue."
          : "Downloading archive files",
      downloadedBytes: 42000000,
      reportedSize: 100000000,
      downloadSpeedBytesPerSec: 2300000,
      etaSeconds: 26,
      retryCount: 0,
      maxRetries: 3,
      threadMode: "auto",
      threadCount: 3,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await page.route("**/rpc/jobs/list", (route) =>
    route.fulfill({ json: { json: { items } } }),
  );
  await page.goto("/");
  await expect(page.locator(".download-row")).toHaveCount(3);
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const row of await page.locator(".download-row").all()) {
        await row.scrollIntoViewIfNeeded();
        expect(
          await row.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBe(true);
        for (const control of await row.getByRole("button").all()) {
          await expect(control).toBeVisible();
          const bounds = await control.boundingBox();
          expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
          expect(
            (bounds?.x ?? 0) + (bounds?.width ?? Infinity),
          ).toBeLessThanOrEqual(width);
        }
      }
      await expectNoHorizontalOverflow(page);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.locator(".download-row").first().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`transfers-${String(width)}-${theme}.png`),
        animations: "disabled",
        fullPage: true,
      });
    }
  }
});
