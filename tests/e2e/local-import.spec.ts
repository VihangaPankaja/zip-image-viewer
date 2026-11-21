import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { startLocalImportApp } from "../fixtures/localImportApp";
import { setCssViewport } from "./helpers/viewport";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });
for (const width of [390, 1440]) {
  test(`local drop and picker import ZIP, image, text and audio at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Missing frontend URL");
    const app = await startLocalImportApp(baseURL);
    try {
      await setCssViewport(page, width, 850);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto(app.origin);
      const picker = page.getByLabel("Choose local files", { exact: true });
      await picker.focus();
      await expect(picker).toBeFocused();
      const chooser = page.waitForEvent("filechooser");
      if (width === 390) await tapVisibleTarget(picker);
      else await picker.press("Enter");
      await (
        await chooser
      ).setFiles([app.file("image.png"), app.file("notes.txt"), app.file("audio.wav")]);
      await expect
        .poll(
          async () =>
            (await app.client.jobs.list()).items.filter((job) => job.status === "ready").length,
        )
        .toBe(3);
      const payload = await readFile(app.archive);
      const drop = await page.evaluateHandle(
        ({ bytes }) => {
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([new Uint8Array(bytes)], "collection.zip", { type: "application/zip" }),
          );
          return transfer;
        },
        { bytes: [...payload] },
      );
      await page
        .getByRole("region", { name: "Import local files" })
        .dispatchEvent("drop", { dataTransfer: drop });
      await drop.dispose();
      await page.getByRole("button", { name: "Review ZIP contents", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Choose ZIP contents" })
        .getByRole("button", { name: "Extract selected files", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await app.client.jobs.list()).items.filter((job) => job.status === "ready").length,
        )
        .toBe(4);
      const jobs = (await app.client.jobs.list()).items;
      expect(new Set(jobs.map((job) => job.sessionId)).size).toBe(4);
      for (const job of jobs) {
        const name = job.localFile?.name;
        if (!name) throw new Error("Missing local filename");
        if (name === "collection.zip") {
          for (const member of ["image.png", "notes.txt", "audio.wav"])
            expect(
              await readFile(path.join(app.directory, "sessions", job.id, "extracted", member)),
            ).toEqual(await app.bytes(member));
        } else
          expect(
            await readFile(
              path.join(app.directory, "sessions", job.id, "extracted", "direct", name),
            ),
          ).toEqual(await app.bytes(name));
      }
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        expect(
          (await new AxeBuilder({ page }).include(".local-import").analyze()).violations,
        ).toEqual([]);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const text = page
        .locator(".download-row")
        .filter({ has: page.getByText("notes.txt", { exact: true }) });
      await text.getByRole("button", { name: "Open", exact: true }).click();
      if (width === 390)
        await tapVisibleTarget(page.locator('label[for="workspace-pane-preview"]'));
      await expect(
        page.getByText("Local text imported without a public URL.", { exact: false }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Downloads", exact: true }).click();
      await page
        .locator(".download-row")
        .filter({ has: page.getByText("image.png", { exact: true }) })
        .getByRole("button", { name: "Open", exact: true })
        .click();
      if (width === 390)
        await tapVisibleTarget(page.locator('label[for="workspace-pane-preview"]'));
      await expect(page.locator(".preview-stage img").first()).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator(".preview-stage img")
            .first()
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBe(64);
      await page.getByRole("tab", { name: "Downloads", exact: true }).click();
      await page
        .locator(".download-row")
        .filter({ has: page.getByText("audio.wav", { exact: true }) })
        .getByRole("button", { name: "Open", exact: true })
        .click();
      if (width === 390)
        await tapVisibleTarget(page.locator('label[for="workspace-pane-preview"]'));
      await page.getByRole("button", { name: "Play audio", exact: true }).click();
      await expect
        .poll(() =>
          page
            .getByLabel("Audio playback")
            .evaluate((audio: HTMLAudioElement) => audio.currentTime),
        )
        .toBeGreaterThan(0);
    } finally {
      await page.close();
      await app.close();
    }
  });
}

test("interrupted browser upload retries one job and cancellation cleans the active stream", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Missing frontend URL");
  const app = await startLocalImportApp(baseURL, true);
  try {
    await page.goto(app.origin);
    let interrupted = false;
    await page.route("**/api/local-imports/*/content", async (route) => {
      if (!interrupted) {
        interrupted = true;
        await route.abort("failed");
      } else await route.continue();
    });
    await page
      .getByLabel("Choose local files", { exact: true })
      .setInputFiles(app.file("notes.txt"));
    await page.getByRole("button", { name: "Retry upload notes.txt", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await app.client.jobs.list()).items.filter((job) => job.status === "ready").length,
      )
      .toBe(1);
    expect((await app.client.jobs.list()).items).toHaveLength(1);
    const large = app.file("large-local-file-with-a-long-name.txt");
    await writeFile(large, Buffer.alloc(8 * 1024 * 1024, 65));
    await page.getByLabel("Choose local files", { exact: true }).setInputFiles(large);
    const cancel = page.getByRole("button", {
      name: "Cancel upload large-local-file-with-a-long-name.txt",
      exact: true,
    });
    await expect
      .poll(
        async () =>
          (await app.client.jobs.list()).items.find((job) =>
            job.localFile?.name.startsWith("large"),
          )?.downloadedBytes ?? 0,
      )
      .toBeGreaterThan(0);
    await cancel.click();
    await expect
      .poll(
        async () =>
          (await app.client.jobs.list()).items.find((job) =>
            job.localFile?.name.startsWith("large"),
          )?.status,
      )
      .toBe("cancelled");
    const job = (await app.client.jobs.list()).items.find((item) =>
      item.localFile?.name.startsWith("large"),
    );
    if (!job) throw new Error("Missing cancelled import");
    await expect
      .poll(async () => readdir(path.join(app.directory, "sessions", job.id, "source")))
      .toEqual([]);
    expect((await app.client.sessions.list()).items).toHaveLength(1);
  } finally {
    await page.close();
    await app.close();
  }
});
