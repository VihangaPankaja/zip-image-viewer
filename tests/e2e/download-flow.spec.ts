import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";

async function expectContained(container: Locator, child: Locator) {
  const [outer, inner] = await Promise.all([
    container.boundingBox(),
    child.boundingBox(),
  ]);
  expect(outer).not.toBeNull();
  expect(inner).not.toBeNull();
  if (!outer || !inner) throw new Error("Expected visible layout bounds.");
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
}

test("queues a magnet on blur, clears the composer, and contains long content", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const downloadName = `${"a-very-long-download-title-".repeat(12)}${testInfo.project.name}-${String(Date.now())}.zip`;
  const magnet =
    "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=" +
    encodeURIComponent(downloadName);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Add downloads" }).click();
  const composer = page.getByRole("dialog");
  await composer
    .getByRole("textbox", { name: "Paste download URLs" })
    .fill(magnet);
  await composer.getByRole("heading", { name: "Add downloads" }).click();

  await expect(
    composer.getByLabel("Download URL", { exact: true }),
  ).toHaveCount(1);
  await expect(
    composer.getByRole("button", { name: "Review links" }),
  ).toHaveCount(0);
  await composer.getByRole("button", { name: "Add to queue" }).click();
  await expect(composer).toBeHidden();

  const row = page.locator(".download-row").filter({ hasText: downloadName });
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expectContained(row, row.locator(".download-row-title > span"));
  await expectContained(row, row.locator(".download-progress-line b"));
  const managerWidth = await page
    .locator(".download-manager")
    .evaluate((manager) => ({
      client: manager.clientWidth,
      scroll: manager.scrollWidth,
    }));
  expect(managerWidth.scroll).toBeLessThanOrEqual(managerWidth.client + 1);
  const overflowingElements = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}.${element.className}`,
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter(({ right }) => right > window.innerWidth + 1),
  );
  expect(overflowingElements).toEqual([]);
  const rowBounds = await row.boundingBox();
  expect(rowBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(
    (rowBounds?.x ?? 0) + (rowBounds?.width ?? Infinity),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("download-queue-mobile.png"),
  });

  await page.getByRole("button", { name: "Add downloads" }).click();
  await expect(
    composer.getByLabel("Download URL", { exact: true }),
  ).toHaveCount(0);
  await expect(
    composer.getByRole("textbox", { name: "Paste download URLs" }),
  ).toHaveValue("");
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("download-composer-mobile.png"),
  });

  await composer.getByRole("button", { name: "Close" }).click();
  await row.getByRole("button", { name: "Cancel" }).click();
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toBeHidden();
});

test("confirms an oversized transfer through the browser control flow", async ({
  page,
}) => {
  const job = {
    id: "00000000-0000-4000-8000-000000000001",
    url: "https://downloads.example.com/oversized-archive.zip",
    sourceKind: "http",
    sourcePreference: "auto",
    status: "awaiting_confirmation",
    phase: "confirm",
    percent: null,
    queuePosition: 0,
    requiresConfirmation: true,
    message: "Archive is 1.1 GB and needs confirmation before download.",
    createdAt: 1,
    updatedAt: 1,
  };
  let confirmCalls = 0;
  await page.route("**/rpc/jobs/list", (route) =>
    route.fulfill({ json: { json: { items: [job] } } }),
  );
  await page.route("**/rpc/jobs/confirm", async (route) => {
    confirmCalls += 1;
    if (confirmCalls === 1) {
      await route.abort("failed");
      return;
    }
    Object.assign(job, {
      status: "queued",
      phase: "queued",
      requiresConfirmation: false,
      message: "Confirmed. Waiting to start",
    });
    await route.fulfill({ json: { json: job } });
  });
  await page.goto("/");

  await expect(page.getByText(/1\.1 GB and needs confirmation/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm & download" }).click();

  const row = page.locator(".download-row");
  const alert = row.getByRole("alert");
  await expect(alert).toBeVisible();
  await alert.evaluate((element) => {
    element.textContent = "confirmation-error-".repeat(60);
  });
  await expectContained(row, alert);
  expect(
    await row.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Confirm & download" }).click();

  await expect(page.getByText("Confirmed. Waiting to start")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm & download" }),
  ).toHaveCount(0);
  expect(confirmCalls).toBe(2);
});
