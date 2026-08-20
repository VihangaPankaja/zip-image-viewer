import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("renders the unified media workspace and opens settings", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Media workspace" }),
  ).toBeVisible();
  await expect(page.getByLabel("Sessions and downloads")).toBeVisible();
  await expect(page.getByLabel("Add public URL")).toBeVisible();

  const panelMinimums = [
    { label: "Sessions panel", minimum: 180 },
    { label: "Files panel", minimum: 220 },
    { label: "Preview panel", minimum: 400 },
    { label: "Metadata panel", minimum: 170 },
  ] as const;
  for (const panel of panelMinimums) {
    const bounds = await page.getByLabel(panel.label).boundingBox();
    expect(
      bounds?.width ?? 0,
      `${panel.label} should not collapse`,
    ).toBeGreaterThan(panel.minimum);
  }

  const screenshot = await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("workspace-desktop.png"),
  });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);

  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("mobile navigation switches workspace panes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("workspace-layout")).toHaveAttribute(
    "data-mobile-pane",
    "files",
  );
});

test("has no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
