// Run from the repository root: node docs/app-roadmap.check.mjs
/* global URL, Buffer, document, window, Event, innerWidth, process, console */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("./app-roadmap.html", import.meta.url).href);
  assert.equal(await page.locator(".card").count(), 28);
  assert.equal(
    await page.getByLabel("V01 status", { exact: true }).inputValue(),
    "Done",
  );
  assert.match(
    await page.locator("#note-V01").inputValue(),
    /baseline report/i,
  );
  assert.equal(await page.locator("#percent").textContent(), "4%");
  await page
    .getByLabel("V01 status", { exact: true })
    .selectOption("In progress");
  await page.locator("#V01 summary").click();
  await page
    .locator("#note-V01")
    .fill("Verified locally <script>never execute</script>");
  await page.reload();
  assert.equal(
    await page.getByLabel("V01 status", { exact: true }).inputValue(),
    "In progress",
  );
  assert.equal(
    await page.locator("#note-V01").inputValue(),
    "Verified locally <script>never execute</script>",
  );
  assert.equal(await page.locator("#percent").textContent(), "0%");
  await page.getByLabel("V01 status", { exact: true }).selectOption("Done");
  await page.getByLabel("Search ideas").fill("SQLite");
  assert.equal(await page.locator(".card:visible").count(), 1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.locator("#status").selectOption("Done");
  assert.equal(await page.locator(".card:visible").count(), 1);
  await page.getByLabel("Search ideas").fill("nothing-will-match-this");
  assert.equal(await page.locator("#empty").isVisible(), true);
  await page.getByRole("button", { name: "Clear filters" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export progress" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let exported = "";
  for await (const chunk of stream) exported += chunk;
  const payload = JSON.parse(exported);
  assert.equal(payload.items.V01.status, "Done");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByLabel("V01 status", { exact: true }).selectOption("Planned");
  await page.locator("#import-file").setInputFiles({
    name: "progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(exported),
  });
  await page.waitForFunction(
    () => document.querySelector("#state-V01").value === "Done",
  );
  await page.locator("#import-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      '{"version":1,"items":{"V01":{"status":"Bad","note":""}}}',
    ),
  });
  await page.waitForFunction(() =>
    document.querySelector("#notice").textContent.startsWith("Import failed."),
  );
  assert.equal(
    await page.getByLabel("V01 status", { exact: true }).inputValue(),
    "Done",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  assert.equal(await page.locator(".card details[open]").count(), 28);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  for (const width of [1440, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `Overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.ROADMAP_SCREENSHOT)
    await page.screenshot({ path: process.env.ROADMAP_SCREENSHOT });
  assert.deepEqual(errors, []);
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(new URL("./app-roadmap.html", import.meta.url).href);
  await blockedPage
    .getByLabel("V01 status", { exact: true })
    .selectOption("Planned");
  assert.match(
    await blockedPage.locator("#notice").textContent(),
    /storage is unavailable/,
  );
  assert.equal(await blockedPage.locator("#percent").textContent(), "0%");
  console.log(
    "Roadmap checks passed: persistence, filters, export/import, invalid data, print, responsive widths and blocked storage.",
  );
} finally {
  await browser.close();
}
