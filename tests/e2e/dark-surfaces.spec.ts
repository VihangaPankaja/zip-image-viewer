import { measureThemeContrast } from "./helpers/themeContrast";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [390, 820, 1440, 2560]) {
  for (const surface of ["charcoal", "amoled"] as const) {
    test(`${surface} surfaces, contrast and portals at ${String(width)}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await page.addInitScript((value) => {
        localStorage.setItem("zip-image-viewer-dark-surface", value);
      }, surface);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-dark-surface", surface);
      await expect(page.locator("body")).toHaveCSS(
        "background-color",
        surface === "amoled" ? "rgb(5, 5, 5)" : "rgb(17, 18, 20)",
      );
      const ratios = await measureThemeContrast(page);
      for (const { pair, ratio, minimum } of ratios)
        expect(ratio, pair).toBeGreaterThanOrEqual(minimum);
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
      await expect(
        dialog.getByRole("radio", { name: surface === "amoled" ? "AMOLED" : "Charcoal" }),
      ).toBeChecked();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await dialog.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(
        dialog.getByRole("radio", { name: surface === "amoled" ? "AMOLED" : "Charcoal" }),
      ).toBeFocused();
      await expect(page.locator(".theme-option:has(:focus-visible)")).toHaveCSS(
        "outline-style",
        "solid",
      );
      await page.screenshot({ path: testInfo.outputPath("settings.png") });
      await dialog.getByRole("button", { name: "Default sort", exact: true }).click();
      await expect(page.getByRole("listbox")).toHaveCSS(
        "background-color",
        surface === "amoled" ? "rgb(32, 32, 34)" : "rgb(42, 43, 46)",
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.emulateMedia({ forcedColors: "active" });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await dialog.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      if (surface === "charcoal") await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Space");
      await expect(dialog.getByRole("radio", { name: "AMOLED" })).toBeChecked();
      await expect(page.locator(".theme-option:has(:focus-visible)")).toHaveCSS(
        "outline-style",
        "solid",
      );
      await page.screenshot({ path: testInfo.outputPath("forced-colors.png") });
    });
  }
}

test("dark surfaces persist across mode changes, reload and OS changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByText("AMOLED", { exact: true }).click();
  await dialog.getByText("Light", { exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(240, 244, 246)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-dark-surface", "amoled");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByText("System", { exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(5, 5, 5)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(5, 5, 5)");
});

test("startup applies saved surface before React loads", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("zip-image-viewer-theme", "dark");
    localStorage.setItem("zip-image-viewer-dark-surface", "amoled");
  });
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#root")).toBeEmpty();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-dark-surface", "amoled");
});

test("dark surface controls remain usable when storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"]) {
      Object.defineProperty(Storage.prototype, method, {
        value: () => {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
    }
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-dark-surface", "charcoal");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("AMOLED", { exact: true }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(5, 5, 5)");
});
