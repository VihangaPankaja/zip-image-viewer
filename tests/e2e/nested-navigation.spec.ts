import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { startZipSelectionApp } from "../fixtures/zipSelectionApp";
import { tapVisibleTarget } from "./touch";
import { setCssViewport } from "./helpers/viewport";

test.use({ hasTouch: true });
for (const width of [390, 1440]) {
  test(`nested ZIP to 7z navigation, history, recovery and safe reset at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error("Missing frontend URL");
    const app = await startZipSelectionApp(baseURL, true);
    try {
      await setCssViewport(page, width, 850);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(app.origin);
      await page.getByRole("button", { name: "Review ZIP contents", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Choose ZIP contents" });
      await review.getByRole("button", { name: "Select none", exact: true }).click();
      await review.getByRole("checkbox", { name: "inside.7z", exact: true }).check();
      await review.getByRole("button", { name: "Extract selected files", exact: true }).click();
      await page.getByRole("button", { name: "Open", exact: true }).click();
      if (width === 390)
        await tapVisibleTarget(page.locator('label[for="workspace-pane-preview"]'));
      await expect(page.getByRole("button", { name: "Open archive", exact: true })).toBeVisible();
      const rootLocation = page.url();
      const open = page.getByRole("button", { name: "Open archive", exact: true });
      await open.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Open archive", exact: true });
      await expect(
        dialog.getByRole("checkbox", { name: "read-me.txt", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(open).toBeFocused();
      if (width === 390) await tapVisibleTarget(open);
      else await open.click();
      await dialog.getByRole("checkbox", { name: "read-me.txt", exact: true }).check();
      expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
      await dialog.getByRole("button", { name: "Open selected files", exact: true }).click();
      await expect(
        page.getByText("Text inside a selected nested 7z archive.", { exact: true }),
      ).toBeVisible();
      const childLocation = page.url();
      expect(childLocation).not.toBe(rootLocation);
      const breadcrumbs = page.getByRole("navigation", { name: "Archive navigation" });
      await expect(
        breadcrumbs.getByRole("button", { name: "collection", exact: true }),
      ).toBeVisible();
      await page.goBack();
      await expect(open).toBeVisible();
      await page.goForward();
      await expect(
        page.getByText("Text inside a selected nested 7z archive.", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByText("Text inside a selected nested 7z archive.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Help and shortcuts" }).click();
      await expect(page.getByRole("dialog", { name: "Help and shortcuts" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Help and shortcuts" })).toBeFocused();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("button", { name: "Reset browser preferences" }).click();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
      await expect(
        page.getByText("Text inside a selected nested 7z archive.", { exact: true }),
      ).toBeVisible();
      expect((await app.client.sessions.list()).items).toHaveLength(1);
      expect(app.requests).toBe(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    } finally {
      await page.close();
      await app.close();
    }
  });
}
