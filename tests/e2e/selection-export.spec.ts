import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import unzipper from "unzipper";
import { startZipSelectionApp, zipSelectionNames } from "../fixtures/zipSelectionApp";
import { tapVisibleTarget } from "./touch";
import { setCssViewport } from "./helpers/viewport";

test.use({ hasTouch: true });
for (const width of [390, 1440]) {
  test(`selection ZIP preserves folders and bytes with keyboard, pointer and touch at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Missing frontend URL");
    const app = await startZipSelectionApp(baseURL);
    try {
      await setCssViewport(page, width, 850);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(app.origin);
      await page.getByRole("button", { name: "Review ZIP contents", exact: true }).click();
      const review = page.getByRole("dialog", { name: "Choose ZIP contents" });
      await review.getByRole("button", { name: "Extract selected files", exact: true }).click();
      await page.getByRole("button", { name: "Open", exact: true }).click();
      const select = page.getByRole("button", { name: "Select files", exact: true });
      if (width === 390) await tapVisibleTarget(select);
      else await select.click();
      const tree = page.getByRole("tree", { name: "Explorer tree" });
      const folder = tree.getByRole("treeitem", { name: "album Folder", exact: true });
      await folder.focus();
      await page.keyboard.press("Space");
      await expect(folder).toHaveAttribute("aria-selected", "true");
      await tree.getByRole("button", { name: "Expand album", exact: true }).click();
      const first = tree.getByRole("treeitem", {
        name: `${zipSelectionNames[0].split("/").at(-1)} txt`,
        exact: true,
      });
      await expect(first).toHaveAttribute("aria-selected", "true");
      // Deselecting one descendant must remove the parent selection from the POST.
      if (width === 390) await tapVisibleTarget(first);
      else await first.click();
      await expect(first).toHaveAttribute("aria-selected", "false");
      await first.focus();
      await page.keyboard.press("Enter");
      await expect(first).toHaveAttribute("aria-selected", "true");
      await page.getByRole("searchbox", { name: "Search explorer files" }).fill("leave-compressed");
      await expect(
        page.getByRole("button", { name: "Download selection", exact: true }),
      ).toBeEnabled();
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.evaluate(async () => {
          await Promise.all(
            document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
          );
        });
        expect(
          (await new AxeBuilder({ page }).include(".selection-explorer").analyze()).violations,
        ).toEqual([]);
      }
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download selection", exact: true }).click();
      const saved = await download;
      expect(saved.suggestedFilename()).toBe("selection.zip");
      const filename = await saved.path();
      if (!filename) throw new Error("Download did not finish");
      const zip = await unzipper.Open.file(filename);
      const files = zip.files.filter((entry) => entry.type === "File");
      expect(files.map((entry) => entry.path).sort()).toEqual(zipSelectionNames.slice(0, 2).sort());
      for (const entry of files)
        expect((await entry.buffer()).toString()).toBe(
          `Selected file ${zipSelectionNames.indexOf(entry.path)}`,
        );
      await expect(
        page.getByText("Download requested. Check your browser's downloads to track or cancel it."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Clear selection", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Download selection", exact: true }),
      ).toBeDisabled();
      await page.getByRole("searchbox", { name: "Search explorer files" }).fill("");
      await tree.getByRole("treeitem", { name: "album Folder", exact: true }).click();
      if (width === 390)
        await tapVisibleTarget(page.locator('label[for="workspace-pane-preview"]'));
      await page.getByRole("button", { name: "Open explorer", exact: true }).click();
      const explorer = page.getByRole("dialog", { name: "collection", exact: true });
      await expect(
        explorer.getByRole("treeitem", { name: "album Folder", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        explorer.getByRole("button", { name: "Download selection", exact: true }),
      ).toBeEnabled();
      expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Open explorer", exact: true })).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    } finally {
      await page.close();
      await app.close();
    }
  });
}
