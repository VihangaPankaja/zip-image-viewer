import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installReviewFixtures } from "../review/fixtures";
import { setCssViewport } from "./helpers/viewport";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });

test("a pending session keeps the empty file area keyboard accessible", async ({ page }) => {
  await setCssViewport(page, 320, 640);
  await installReviewFixtures(page);
  await page.route("**/api/sessions/*/tree", () => {});
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page.getByRole("button", { name: "Show sessions", exact: true }).click();
  await page
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("short-screen download batches keep submit and close reachable while drafts scroll", async ({
  page,
}) => {
  await installReviewFixtures(page);
  await page.route("**/rpc/jobs/enqueue", (route) =>
    route.fulfill({
      status: 503,
      json: {
        json: {
          defined: false,
          code: "SERVICE_UNAVAILABLE",
          status: 503,
          message: "Cannot reach the download service. ".repeat(20),
        },
      },
    }),
  );
  for (const [width, height] of [
    [320, 640],
    [844, 390],
    [640, 400],
  ]) {
    await setCssViewport(page, width, height);
    await page.goto("/");
    const opener = page.getByRole("button", { name: "Add downloads", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Add downloads" });
    const submit = dialog.getByRole("button", { name: "Add to queue", exact: true });
    await dialog
      .getByRole("textbox", { name: "Paste download URLs" })
      .fill(
        Array.from({ length: 12 }, (_, i) => `https://example.com/long-archive-name-${i}.zip`).join(
          "\n",
        ),
      );
    await dialog.getByRole("heading").click();
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeEnabled();
    await dialog.getByLabel("Download URL", { exact: true }).last().scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await tapVisibleTarget(submit);
    await expect(dialog.getByRole("alert")).toContainText("Cannot reach the download service");
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeEnabled();
    await expect(dialog.getByLabel("Download URL", { exact: true })).toHaveCount(12);
    await submit.focus();
    await page.keyboard.press("Shift+Tab");
    const error = dialog.getByRole("alert");
    await expect(error).toBeFocused();
    await page.keyboard.press("PageDown");
    await expect.poll(() => error.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
  }
});
