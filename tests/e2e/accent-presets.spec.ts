import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { measureThemeContrast } from "./helpers/themeContrast";

for (const accent of ["teal", "blue", "violet", "amber", "rose"]) {
  test(`${accent} passes text, hover, selection and focus contrast in every palette`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("zip-image-viewer-accent", value),
      accent,
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    const radio = dialog.getByRole("radio", { name: accent, exact: false });
    await expect(radio).toBeChecked();
    for (const palette of ["light", "charcoal", "amoled"]) {
      await dialog.getByText(palette === "light" ? "Light" : "Dark", { exact: true }).click();
      if (palette !== "light")
        await dialog
          .getByText(palette === "amoled" ? "AMOLED" : "Charcoal", { exact: true })
          .click();
      for (const { pair, ratio, minimum } of await measureThemeContrast(page, palette !== "light"))
        expect(ratio, `${palette} ${pair}`).toBeGreaterThanOrEqual(minimum);
      await radio.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(page.locator(".theme-option:has(:focus-visible)")).toHaveCSS(
        "outline-style",
        "solid",
      );
      expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
    }
  });

  test(`${accent} applies before the app loads`, async ({ page }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("zip-image-viewer-theme", "dark");
      localStorage.setItem("zip-image-viewer-dark-surface", "amoled");
      localStorage.setItem("zip-image-viewer-accent", value);
    }, accent);
    await page.route("**/src/main.tsx", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("#root")).toBeEmpty();
    await expect(page.locator("html")).toHaveAttribute("data-accent", accent);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute("data-dark-surface", "amoled");
  });
}

test("accents persist across reload, mode overrides and live System changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("radio", { name: "Blue", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "Violet", exact: true })).toBeChecked();
  await dialog.getByText("AMOLED", { exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
  await dialog.getByText("Light", { exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-dark-surface", "amoled");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await dialog.getByText("System", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
});

test("missing and invalid accents keep existing theme and surface preferences", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("zip-image-viewer-theme", "dark");
    localStorage.setItem("zip-image-viewer-dark-surface", "amoled");
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "teal");
  await page.evaluate(() => localStorage.setItem("zip-image-viewer-accent", "invalid"));
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "teal");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-dark-surface", "amoled");
});

test("blocked storage keeps accents usable and explains persistence", async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem"])
      Object.defineProperty(Storage.prototype, method, {
        value: () => {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Rose", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "rose");
  await expect(
    page.getByRole("status").filter({ hasText: "Accent applies to this tab" }),
  ).toBeVisible();
});

test("accent labels work with touch at a narrow viewport", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 320, height: 640 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).tap();
  for (const accent of ["Teal", "Blue", "Violet", "Amber", "Rose"]) {
    const label = page.locator(".theme-option").filter({ hasText: accent });
    await label.tap();
    await expect(page.getByRole("radio", { name: accent, exact: true })).toBeChecked();
    const bounds = await label.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page
      .getByRole("dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  await context.close();
});
