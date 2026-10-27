import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { startUnreliableOriginApp } from "../fixtures/unreliableOriginApp";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });
for (const width of [390, 1440]) {
  test(`unreliable HTTP recovery, retry, login error and cancellation at ${width}px`, async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Missing client URL");
    const fixture = await startUnreliableOriginApp(baseURL);
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(fixture.origin);
      await page.evaluate(() => {
        localStorage.setItem("theme", "dark");
      });
      const enqueue = async (name: string) => {
        await page.getByRole("button", { name: "Add downloads", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Add downloads", exact: true });
        const input = dialog.getByRole("textbox", { name: "Paste download URLs" });
        await input.fill(`${fixture.sourceOrigin}/${name}`);
        await input.press("Tab");
        const add = dialog.getByRole("button", { name: "Add to queue", exact: true });
        if (width === 390) await tapVisibleTarget(add);
        else {
          await add.focus();
          await page.keyboard.press("Enter");
        }
        await expect(dialog).toBeHidden();
        return page.locator(".download-row").filter({ hasText: name });
      };
      for (const name of ["recovered-notes.txt", "retry-notes.txt"]) {
        const row = await enqueue(name);
        if (name.startsWith("retry")) await expect(row).toContainText("retrying in 3.0s");
        await expect(row.getByRole("button", { name: "Open", exact: true })).toBeVisible({
          timeout: 15_000,
        });
        const jobs = (await fixture.client.jobs.list()).items;
        const job = jobs.find((entry) => entry.url.endsWith(name));
        if (!job) throw new Error("Missing downloaded job");
        const contents = await readFile(
          path.join(fixture.directory, "sessions", job.id, "source.txt"),
        );
        expect(createHash("sha256").update(contents).digest("hex")).toBe(
          createHash("sha256").update(fixture.payload).digest("hex"),
        );
        if (name.startsWith("recovered")) {
          expect(job.threadMode).toBe("single");
          expect(job.threadCount).toBe(1);
        }
      }
      const login = await enqueue("expired-notes.txt");
      await expect(login).toContainText("login or error page");
      await expect(login.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      expect(
        fixture.requests.filter(
          (entry) => entry.path === "/expired-notes.txt" && entry.method === "GET",
        ),
      ).toHaveLength(1);
      fixture.fixLogin();
      const retry = login.getByRole("button", { name: "Retry", exact: true });
      if (width === 390) await tapVisibleTarget(retry);
      else await retry.click();
      await expect(login.getByRole("button", { name: "Open", exact: true })).toBeVisible({
        timeout: 15_000,
      });
      const cancel = await enqueue("cancel-notes.txt");
      await expect(cancel).toContainText("retrying in 30.0s");
      const cancelButton = cancel.getByRole("button", { name: "Cancel", exact: true });
      await cancelButton.focus();
      await page.keyboard.press("Enter");
      await expect(cancel).toContainText("Archive loading was cancelled.");
      expect(
        fixture.requests.filter(
          (entry) => entry.path === "/cancel-notes.txt" && entry.method === "GET",
        ),
      ).toHaveLength(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    } finally {
      await page.close();
      await fixture.close();
    }
  });
}
