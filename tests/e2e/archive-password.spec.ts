import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { startZipSelectionApp } from "../fixtures/zipSelectionApp";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });
for (const width of [390, 1440]) {
  for (const type of ["zip", "7z"] as const) {
    test(`encrypted ${type} wrong password, retry and restart at ${width}px`, async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(90_000);
      if (!baseURL) throw new Error("Missing frontend URL");
      const password = "browser-fixture-$()";
      const app = await startZipSelectionApp(baseURL, false, false, {
        type,
        password,
        headers: true,
      });
      const urls: string[] = [];
      const passwordMethods: string[] = [];
      page.on("request", (request) => {
        urls.push(decodeURIComponent(request.url()));
        if (new URL(request.url()).pathname === "/rpc/jobs/password")
          passwordMethods.push(request.method());
      });
      try {
        await page.setViewportSize({ width, height: 850 });
        await page.emulateMedia({ colorScheme: "dark" });
        await page.goto(app.origin);
        if (type === "zip") {
          await page.getByRole("button", { name: "Review ZIP contents", exact: true }).click();
          await page.getByRole("button", { name: "Extract selected files", exact: true }).click();
        }
        const enter = page.getByRole("button", { name: "Enter password", exact: true });
        await expect(enter).toBeVisible({ timeout: 20_000 });
        await enter.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Unlock archive", exact: true });
        const field = dialog.getByLabel("Archive password", { exact: true });
        await expect(field).toBeFocused();
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await page.evaluate(async () => {
            await Promise.all(
              document
                .getAnimations()
                .map((animation) => animation.finished.catch(() => undefined)),
            );
          });
          expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual(
            [],
          );
        }
        await field.fill("wrong");
        await page.keyboard.press("Enter");
        await expect(dialog.getByRole("status")).toContainText("rejected");
        await expect(field).toHaveValue("");
        await page.keyboard.press("Escape");
        await expect(enter).toBeFocused();
        if (width === 390) await tapVisibleTarget(enter);
        else await enter.click();
        await field.fill(password);
        await dialog.getByRole("button", { name: "Unlock archive", exact: true }).click();
        await expect(dialog.getByRole("status")).toContainText("ready to browse");
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        expect(
          await readFile(
            path.join(app.directory, "sessions", app.id, "extracted", "album/second.txt"),
            "utf8",
          ),
        ).toBe("Selected file 1");
        expect(app.requests).toBe(1);
        expect(urls.join(" ")).not.toContain(password);
        expect(passwordMethods).toEqual(["POST", "POST"]);
        expect(app.logs()).not.toContain(password);
        expect(
          await page.evaluate(() =>
            JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
          ),
        ).not.toContain(password);
        await app.restart();
        await page.reload();
        await expect(enter).toBeVisible();
        await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
        expect(await readdir(path.join(app.directory, "sessions", app.id))).not.toContain(
          "extracted.staging",
        );
        expect(app.requests).toBe(1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
      } finally {
        await page.close();
        await app.close();
      }
    });
  }
}

test("nested encrypted headers prompt for listing and selected extraction without remembering the password", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Missing frontend URL");
  const password = "nested-browser-fixture";
  const app = await startZipSelectionApp(baseURL, true, false, {
    password,
    headers: true,
    nestedOnly: true,
  });
  try {
    await page.goto(app.origin);
    await page.getByRole("button", { name: "Review ZIP contents", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Choose ZIP contents" });
    await review.getByRole("button", { name: "Select none", exact: true }).click();
    await review.getByRole("checkbox", { name: "inside.7z", exact: true }).check();
    await page.getByRole("button", { name: "Extract selected files", exact: true }).click();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Open archive", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Open archive", exact: true });
    const field = dialog.getByLabel("Archive password", { exact: true });
    await expect(field).toBeVisible();
    await field.fill("wrong");
    await field.press("Enter");
    await expect(dialog.getByRole("status")).toContainText("rejected");
    await field.fill(password);
    await field.press("Enter");
    await dialog.getByRole("checkbox", { name: "read-me.txt", exact: true }).check();
    await dialog.getByRole("button", { name: "Open selected files", exact: true }).click();
    await field.fill("wrong");
    await field.press("Enter");
    await expect(dialog.getByRole("status")).toContainText("rejected");
    await field.fill(password);
    await field.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText("Text inside a selected nested 7z archive.", { exact: true }),
    ).toBeVisible();
    expect(app.requests).toBe(1);
  } finally {
    await page.close();
    await app.close();
  }
});
