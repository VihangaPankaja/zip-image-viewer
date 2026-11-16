import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { startArchiveVolumesApp } from "../fixtures/archiveVolumesApp";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });
for (const width of [390, 1440]) {
  test(`missing multipart volume recovery with keyboard and touch at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Missing frontend URL");
    const app = await startArchiveVolumesApp(baseURL);
    try {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(app.origin);
      const action = page.getByRole("button", { name: "Supply volumes", exact: true });
      await expect(action).toBeVisible({ timeout: 25_000 });
      await expect(page.locator(".download-row")).toHaveCount(1);
      await action.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Supply archive volumes", exact: true });
      const field = dialog.getByRole("textbox", { name: "Volume URLs", exact: true });
      await expect(field).toBeFocused();
      await field.fill("https://example.com/unrelated.7z.003");
      await dialog.getByRole("button", { name: "Check volumes", exact: true }).click();
      await expect(dialog.getByRole("alert")).toContainText("same archive");
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect
          .poll(() => dialog.evaluate((element) => element.getAnimations({ subtree: true }).length))
          .toBe(0);
        expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
      }
      await page.keyboard.press("Escape");
      await expect(action).toBeFocused();
      if (width === 390) await tapVisibleTarget(action);
      else await action.click();
      await field.fill(app.url(app.names[app.names.length - 1]));
      await dialog.getByRole("button", { name: "Check volumes", exact: true }).click();
      await expect(dialog.getByRole("status")).toContainText("ready to browse", {
        timeout: 25_000,
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.getByRole("button", { name: "Open", exact: true })).toBeVisible();
      expect([...app.requests.values()]).toEqual(app.names.map(() => 1));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
}
