import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { startZipSelectionApp, zipSelectionNames } from "../fixtures/zipSelectionApp";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });
for (const width of [390, 1440]) {
  test(`ZIP review, selection, restart and Extract more at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Missing frontend URL");
    const app = await startZipSelectionApp(baseURL);
    try {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(app.origin);
      const review = page.getByRole("button", { name: "Review ZIP contents", exact: true });
      await expect(review).toBeVisible({ timeout: 20_000 });
      const extracted = path.join(app.directory, "sessions", app.id, "extracted");
      expect(await readdir(extracted)).toEqual([]);
      await app.restart();
      await page.reload();
      await expect(review).toBeVisible();
      await review.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Choose ZIP contents" });
      await expect(
        dialog.getByRole("checkbox", { name: zipSelectionNames[0], exact: true }),
      ).toBeVisible();
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
      }
      await page.keyboard.press("Escape");
      await expect(review).toBeFocused();
      if (width === 390) await tapVisibleTarget(review);
      else await review.click();
      await dialog.getByRole("button", { name: "Select none", exact: true }).click();
      const submit = dialog.getByRole("button", { name: "Extract selected files", exact: true });
      await expect(submit).toBeDisabled();
      await dialog.getByRole("checkbox", { name: "album", exact: true }).focus();
      await page.keyboard.press("Space");
      await expect(dialog.getByRole("status")).toContainText("2 files selected");
      await expect(submit).toBeInViewport();
      await submit.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Open", exact: true })).toBeVisible();
      expect(await readdir(extracted)).toEqual(["album"]);
      expect(await readFile(path.join(extracted, zipSelectionNames[0]), "utf8")).toBe(
        "Selected file 0",
      );
      expect(await readFile(path.join(extracted, zipSelectionNames[1]), "utf8")).toBe(
        "Selected file 1",
      );
      const originalSession = (await app.client.jobs.list()).items[0].sessionId;
      await app.restart();
      await page.reload();
      expect((await app.client.jobs.list()).items[0].sessionId).toBe(originalSession);
      const more = page.getByRole("button", { name: "Extract more", exact: true });
      await more.click();
      const search = dialog.getByRole("searchbox", { name: "Search ZIP files" });
      await search.fill("leave-compressed");
      await expect(
        dialog.getByRole("checkbox", { name: zipSelectionNames[2], exact: true }),
      ).toBeChecked();
      await expect(
        dialog.getByRole("checkbox", { name: zipSelectionNames[0], exact: true }),
      ).toHaveCount(0);
      await dialog.getByRole("button", { name: "Extract selected files", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "View ZIP contents", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("status", { name: "collection.zip", exact: true })).toHaveText(
        "ready",
      );
      expect(await readFile(path.join(extracted, zipSelectionNames[2]), "utf8")).toBe(
        "Selected file 2",
      );
      expect(await readFile(path.join(extracted, zipSelectionNames[0]), "utf8")).toBe(
        "Selected file 0",
      );
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
