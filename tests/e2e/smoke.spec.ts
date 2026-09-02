import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("manages downloads and opens the Explore workspace", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Transfer desk" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Downloads" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Downloads", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add downloads" }).click();
  await page
    .getByRole("textbox", { name: "Paste download URLs" })
    .fill("https://example.com/a.zip\nhttps://example.com/b.zip");
  await page.getByRole("button", { name: "Review links" }).click();
  await expect(page.getByLabel("Download URL", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(
    page.getByRole("region", { name: "Explorer sidebar" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Preview panel" }),
  ).toBeVisible();
  const sidebar = await page
    .getByRole("region", { name: "Explorer sidebar" })
    .boundingBox();
  const preview = await page
    .getByRole("region", { name: "Preview panel" })
    .boundingBox();
  expect(sidebar?.width ?? 0).toBeGreaterThan(220);
  expect(preview?.width ?? 0).toBeGreaterThan(420);

  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("workspace-desktop.png"),
  });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  expect(consoleErrors).toEqual([]);
});

test("mobile uses a full-screen add sheet and tree-to-preview navigation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Add downloads" }).click();
  const dialogBounds = await page.getByRole("dialog").boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(dialogBounds?.width ?? 0).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(dialogBounds?.height ?? 0).toBeGreaterThanOrEqual(viewport.height - 1);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(page.getByRole("radio", { name: "Files" })).toBeChecked();
  await expect(
    page.getByRole("region", { name: "Explorer sidebar" }),
  ).toBeVisible();
  await page.locator('label[for="workspace-pane-preview"]').click();
  await expect(
    page.getByRole("region", { name: "Preview panel" }),
  ).toBeVisible();
  await page.getByText("Back to files").click();
  await expect(page.getByRole("radio", { name: "Files" })).toBeChecked();
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("workspace-mobile.png"),
  });
});

test("both workspaces have no automatically detectable accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("tab", { name: "Explore" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
