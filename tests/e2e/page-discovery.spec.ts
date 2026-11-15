import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { setCssViewport } from "./helpers/viewport";
import { tapVisibleTarget } from "./touch";

test("reviews page links before queueing once, with keyboard and narrow layouts", async ({
  page,
}) => {
  let enqueues = 0;
  let submitted: unknown;
  const sourcePage = "https://example.com/library/";
  const items = Array.from({ length: 24 }, (_, index) => ({
    url: `https://cdn.example.com/download?id=${index}`,
    name: index === 0 ? `${"long-archive-name-".repeat(12)}.zip` : `Library ${index}.zip`,
    type: "ZIP",
    kind: "file",
    confidence: "high",
    sizeBytes: null,
    sourcePage,
  }));
  items.push({
    url: "https://example.com/next",
    name: "Next page",
    type: "Unknown",
    kind: "page",
    confidence: "low",
    sizeBytes: null,
    sourcePage,
  });
  await page.route("**/rpc/discovery/inspect", (route) =>
    route.fulfill({ json: { json: { sourcePage, items, truncated: false } } }),
  );
  await page.route("**/rpc/jobs/enqueue", async (route) => {
    enqueues++;
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { json: { items: [] } } });
  });
  await setCssViewport(page, 360, 740);
  await page.goto("/");
  await page.getByRole("button", { name: "Add downloads" }).click();
  await page.getByRole("button", { name: "From a page" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Page URL" }).fill(sourcePage);
  await dialog.getByRole("textbox", { name: "Page URL" }).press("Enter");
  await expect(dialog.getByRole("checkbox")).toHaveCount(20);
  await expect(dialog.getByRole("button", { name: "Add selected" })).toBeDisabled();
  expect(enqueues).toBe(0);
  const first = dialog.getByRole("checkbox").first();
  await first.focus();
  await first.press("Space");
  await expect(first).toBeChecked();
  await dialog.getByRole("button", { name: "Next links" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Next page" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Previous links" }).click();
  await expect(first).toBeChecked();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  const button = dialog.getByRole("button", { name: "Add selected" });
  const [bounds, outer] = await Promise.all([button.boundingBox(), dialog.boundingBox()]);
  if (!bounds || !outer) throw new Error("Expected visible dialog and submit button.");
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(outer.y + outer.height);
  expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
  await button.click();
  await expect(dialog).toBeHidden();
  expect(enqueues).toBe(1);
  expect(submitted).toMatchObject({
    json: { items: [{ url: items[0].url, sourcePreference: "auto" }] },
  });
  await page.getByRole("button", { name: "Add downloads" }).click();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Page URL" })).toHaveValue("");
  await dialog.getByRole("button", { name: "Direct links" }).click();
  await expect(dialog.getByRole("textbox", { name: "Paste download URLs" })).toBeVisible();
});

test("shows inspection failures and supports touch selection", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await setCssViewport(page, 390, 844);
  let attempts = 0;
  await page.route("**/rpc/discovery/inspect", async (route) => {
    attempts++;
    if (attempts === 1) {
      await route.abort();
      return;
    }
    await route.fulfill({
      json: {
        json: {
          sourcePage: "https://example.com/",
          truncated: false,
          items: [
            {
              url: "https://example.com/photo.jpg",
              name: "Photo",
              type: "JPG",
              kind: "file",
              confidence: "high",
              sizeBytes: null,
              sourcePage: "https://example.com/",
            },
          ],
        },
      },
    });
  });
  await page.goto("/");
  await tapVisibleTarget(page.getByRole("button", { name: "Add downloads" }));
  await tapVisibleTarget(page.getByRole("button", { name: "From a page" }));
  await page.getByRole("textbox", { name: "Page URL" }).fill("https://example.com/");
  await tapVisibleTarget(page.getByRole("button", { name: "Inspect page" }));
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await tapVisibleTarget(page.getByRole("button", { name: "Inspect page" }));
  await tapVisibleTarget(page.getByRole("checkbox", { name: "Photo" }));
  await expect(page.getByRole("button", { name: "Add selected" })).toBeEnabled();
  await page.getByRole("dialog").press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Add downloads" })).toBeFocused();
  await context.close();
});
