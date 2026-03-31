import { test, expect } from "@playwright/test";

test("home renders core tabs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("tab", { name: "Download" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Slideshow" })).toBeVisible();
});
