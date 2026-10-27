import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startTextPreviewApp } from "../fixtures/textPreviewApp";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });
test.setTimeout(60000);

async function openFile(page: Page, name: string) {
  const files = page.getByRole("radio", { name: "Files", exact: true });
  if (await files.isVisible()) await files.check({ force: true });
  const extension = name.split(".").at(-1);
  await tapVisibleTarget(page.getByRole("treeitem", { name: `${name} ${extension}`, exact: true }));
}

test("200 MB text stays bounded, scrolls, searches and navigates by chunk", async ({
  page,
  baseURL,
}) => {
  const fixture = await startTextPreviewApp(baseURL ?? "");
  const sizes: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("textPreview=1"))
      void response.body().then(
        (body) => sizes.push(body.length),
        () => {},
      );
  });
  try {
    await page.goto(fixture.origin);
    await page.getByRole("tab", { name: "Explore" }).click();
    const sessions = page.getByRole("button", { name: "Show sessions" });
    if (await sessions.isVisible()) await sessions.click();
    await page
      .getByRole("list", { name: "Sessions", exact: true })
      .getByRole("button", { name: "Ready 01-large-200MB.log 9 files", exact: true })
      .click();
    await openFile(page, "01-large-200MB.log");
    const content = page.getByRole("region", { name: "Text content", exact: true });
    await expect(content).toContainText("bounded preview");
    expect(
      await page
        .locator(".text-preview")
        .evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    ).toBe(true);
    await expect(page.getByText(/Truncated preview$/)).toBeVisible();
    expect(await page.locator(".text-line").count()).toBeLessThan(100);
    await content.focus();
    await page.keyboard.press("PageDown");
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole("searchbox", { name: "Search loaded chunk only" }).fill("responsive");
    await expect(page.getByText(/matching display rows/)).toBeVisible();
    await page.getByRole("button", { name: "Last chunk" }).click();
    await expect(page.getByRole("button", { name: "Last chunk" })).toBeDisabled();
    await content.focus();
    await page.keyboard.press("Control+End");
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(content).toContainText("FINAL LOG RECORD");
    await page.getByRole("button", { name: "First chunk" }).click();
    await expect(page.getByRole("button", { name: "First chunk" })).toBeDisabled();
    await expect(content).toContainText("bounded preview");
    const next = page.getByRole("button", { name: "Next chunk" });
    let chunkAttempts = 0;
    await page.route("**/file?*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.searchParams.get("textPreview") === "1" &&
        url.searchParams.get("offset") === "131072"
      ) {
        chunkAttempts++;
        if (chunkAttempts === 1) {
          await route.fulfill({ status: 503, body: "Temporary read failure" });
          return;
        }
      }
      await route.continue();
    });
    const firstLine = await content.locator(".text-line-code").first().textContent();
    await next.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Preview unavailable");
    await expect(content.locator(".text-line-code").first()).toHaveText(firstLine ?? "");
    await expect(page.getByText(/Bytes 0–131,072/)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Text chunks" })).toBeVisible();
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Bytes 131,072/)).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(chunkAttempts).toBe(2);
    await expect(next).toBeFocused();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            document.body.dataset.copiedText = text;
            return Promise.resolve();
          },
        },
      }),
    );
    await page.getByRole("button", { name: "Copy loaded text" }).click();
    await expect(page.getByRole("status")).toContainText("Loaded text copied");
    expect(
      await page.evaluate(() => (document.body.dataset.copiedText?.length ?? 0) > 100000),
    ).toBe(true);
    await page.evaluate(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error("Permission denied")),
        },
      }),
    );
    await page.getByRole("button", { name: "Copy loaded text" }).click();
    await expect(page.getByRole("status")).toContainText("Copy unavailable");
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((size) => size < 1024 * 1024)).toBe(true);
    expect((await new AxeBuilder({ page }).include(".text-preview").analyze()).violations).toEqual(
      [],
    );
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await fixture.close();
  }
});

test("narrow text controls support touch, JSON, quoted tables, UTF-16 and binary labels", async ({
  page,
  baseURL,
}) => {
  const fixture = await startTextPreviewApp(baseURL ?? "");
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(fixture.origin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Show sessions" }).click();
    await page
      .getByRole("list", { name: "Sessions", exact: true })
      .getByRole("button", { name: "Ready 01-large-200MB.log 9 files", exact: true })
      .click();
    await page.getByRole("button", { name: "Hide sessions" }).click();
    await openFile(page, "02-quoted.csv");
    await tapVisibleTarget(page.getByRole("button", { name: "Table", exact: true }));
    await expect(page.getByRole("cell", { name: "Coast, west" })).toBeVisible();
    await expect(page.getByText(/Table truncated/)).toBeVisible();
    expect(await page.locator(".text-preview img").count()).toBe(0);
    await openFile(page, "03-data.json");
    await tapVisibleTarget(page.getByRole("button", { name: "Format JSON" }));
    await expect(page.getByRole("status")).toContainText("Numeric values are preserved");
    await openFile(page, "04-malformed.json");
    await tapVisibleTarget(page.getByRole("button", { name: "Format JSON" }));
    await expect(page.getByRole("status")).toContainText("Invalid JSON");
    await openFile(page, "05-utf16be.txt");
    await expect(page.getByRole("region", { name: "Text content", exact: true })).toContainText(
      "Grüße 😀",
    );
    await openFile(page, "06-long-line.txt");
    await page.getByRole("checkbox", { name: "Wrap lines" }).check();
    await page.getByRole("searchbox", { name: "Search loaded chunk only" }).fill("NEEDLE");
    await tapVisibleTarget(page.getByRole("button", { name: "Find next" }));
    await expect(page.locator(".text-line-code").filter({ hasText: "NEEDLE" })).toBeVisible();
    expect(await page.locator(".text-line").count()).toBeLessThan(100);
    await openFile(page, "07-binary.txt");
    await expect(page.getByRole("status")).toContainText("Binary content detected");
    await openFile(page, "08-tabs.tsv");
    await tapVisibleTarget(page.getByRole("button", { name: "Table", exact: true }));
    await expect(page.getByRole("cell", { name: /quoted "value"/ })).toBeVisible();
    await openFile(page, "09-wide-lines.txt");
    await page.getByRole("checkbox", { name: "Wrap lines" }).check();
    const wideContent = page.getByRole("region", { name: "Text content", exact: true });
    expect(
      await wideContent.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await wideContent.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("heading", { name: "09-wide-lines.txt", exact: true }),
    ).toBeVisible();
    await page.getByRole("searchbox", { name: "Search complete file" }).fill("needle");
    await tapVisibleTarget(page.getByRole("button", { name: "Find next" }));
    await expect(page.locator("mark")).toHaveText("NEEDLE");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await page.goto("about:blank").catch(() => undefined);
    await fixture.close();
  }
});
