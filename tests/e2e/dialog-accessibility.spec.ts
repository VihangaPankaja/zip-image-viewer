import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import { test } from "./media-fixture";
import { filenames, installReviewFixtures } from "../review/fixtures";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });

test("dialogs return focus and keep background preview shortcuts isolated", async ({
  page,
  appOrigin,
}) => {
  await installReviewFixtures(page);
  await page.goto(appOrigin);
  const add = page.getByRole("button", { name: "Add downloads", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add downloads" });
  await dialog.getByRole("textbox").fill("https://example.com/film.zip");
  await expect(dialog.getByRole("status")).toHaveText("1 of 50 ready");
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(add).toBeFocused();
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeFocused();
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Coastal collection", exact: true })
    .click();
  await page.getByRole("treeitem", { name: filenames[0], exact: true }).click();
  const selected = page.locator(".preview-panel h2");
  await expect(selected).toHaveText(filenames[0]);
  const explorer = page.getByRole("button", {
    name: "Open explorer",
    exact: true,
  });
  await explorer.click();
  const heading = page.getByRole("dialog").getByRole("heading");
  await heading.evaluate((element) => {
    element.setAttribute("tabindex", "-1");
    (element as HTMLElement).focus();
  });
  await page.keyboard.press("ArrowRight");
  await expect(selected).toHaveText(filenames[0]);
  await page.keyboard.press("Escape");
  await expect(explorer).toBeFocused();
  const slideshow = page.getByRole("button", {
    name: "Slideshow",
    exact: true,
  });
  await slideshow.click();
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(slideshow).toBeFocused();
});

test("touch can dismiss the batch without losing the opener", async ({
  page,
  appOrigin,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await installReviewFixtures(page);
  await page.goto(appOrigin);
  const opener = page.getByRole("button", {
    name: "Add downloads",
    exact: true,
  });
  await tapVisibleTarget(opener);
  await tapVisibleTarget(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true }),
  );
  await expect(opener).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
