import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { startZipSelectionApp, zipSelectionNames } from "../fixtures/zipSelectionApp";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });
for (const width of [360, 1440]) {
  test(`extraction progress, cancel and retained-source retry at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Missing frontend URL");
    const app = await startZipSelectionApp(baseURL, false, true);
    try {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(app.origin);
      await page.getByRole("button", { name: "Review ZIP contents", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Choose ZIP contents" });
      await expect(
        dialog.getByRole("checkbox", { name: zipSelectionNames[0], exact: true }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Select none", exact: true }).click();
      await dialog.getByRole("checkbox", { name: zipSelectionNames[1], exact: true }).check();
      await dialog.getByRole("button", { name: "Extract selected files", exact: true }).click();
      await page.getByRole("button", { name: "Extract more", exact: true }).click();
      await dialog.getByRole("button", { name: "Select none", exact: true }).click();
      await dialog.getByRole("checkbox", { name: zipSelectionNames[0], exact: true }).check();
      await dialog.getByRole("button", { name: "Extract selected files", exact: true }).click();
      await expect(page.getByText("1 / 2 files", { exact: true })).toBeVisible();
      await expect(page.getByText(zipSelectionNames[0], { exact: true })).toBeVisible();
      const progress = page.getByRole("progressbar");
      await expect
        .poll(async () => Number(await progress.getAttribute("value")))
        .toBeGreaterThan(0);
      expect(Number(await progress.getAttribute("value"))).toBeLessThan(100);
      await expect(page.getByText("Speed", { exact: true })).toHaveCount(0);
      await expect(page.getByText("ETA", { exact: true })).toHaveCount(0);
      expect(
        (await new AxeBuilder({ page }).include(".download-manager").analyze()).violations,
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const cancel = page.getByRole("button", { name: "Cancel", exact: true });
      await expect(cancel).toBeInViewport();
      if (width === 360) await tapVisibleTarget(cancel);
      else {
        await cancel.focus();
        await page.keyboard.press("Enter");
      }
      const retry = page.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      const extracted = path.join(app.directory, "sessions", app.id, "extracted");
      expect(await readdir(path.join(extracted, "album"))).toEqual(["second.txt"]);
      await expect
        .poll(async () => readdir(path.dirname(extracted)))
        .not.toContain("extracted.staging");
      await app.restart();
      await page.reload();
      await retry.click();
      await expect(page.getByRole("status", { name: "collection.zip", exact: true })).toHaveText(
        "ready",
        { timeout: 30_000 },
      );
      expect(await readFile(path.join(extracted, zipSelectionNames[0]))).toEqual(
        Buffer.alloc(4 * 1024 * 1024, 65),
      );
      expect(await readFile(path.join(extracted, zipSelectionNames[1]), "utf8")).toBe(
        "Selected file 1",
      );
      expect(app.requests).toBe(1);
    } catch (error) {
      console.error(app.logs());
      throw error;
    } finally {
      await page.close();
      await app.close();
    }
  });
}
