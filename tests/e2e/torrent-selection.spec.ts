import express from "express";
import { once } from "node:events";
import { request } from "node:http";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  type Page,
  type Locator,
} from "@playwright/test";
import {
  filenames,
  installReviewFixtures,
  prepareMedia,
} from "../review/fixtures";

const test = base.extend<{ appOrigin: string }>({
  appOrigin: async ({ baseURL }, provide) => {
    if (!baseURL) throw new Error("The app base URL is required.");
    const mediaDirectory = await prepareMedia();
    const app = express();
    app.get("/api/sessions/:id/video/play", (_req, res) =>
      res.sendFile(path.join(mediaDirectory, "sample.mp4")),
    );
    app.use((req, res) => {
      const upstream = request(
        new URL(req.originalUrl, baseURL),
        {
          method: req.method,
          headers: { ...req.headers, host: new URL(baseURL).host },
        },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.status(502);
        res.end();
      });
      req.pipe(upstream);
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Media fixture did not bind.");
      await provide("http://127.0.0.1:" + String(address.port));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
});

async function keyboardActivate(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press("Enter");
}

test("keyboard adds a torrent, reviews files, starts selection, seeks and closes", async ({
  page,
  appOrigin,
}) => {
  test.setTimeout(90_000);
  const state = await installReviewFixtures(page);
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto(appOrigin);
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Add downloads", exact: true }),
  );
  await page.getByRole("textbox", { name: "Paste download URLs" }).focus();
  await page.keyboard.insertText(
    "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Open%20film%20collection",
  );
  await page.keyboard.press("Tab");
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Add to queue", exact: true }),
  );
  const review = page.getByRole("button", {
    name: "Review files",
    exact: true,
  });
  await expect(review).toBeVisible();
  await keyboardActivate(page, review);
  const dialog = page.getByRole("dialog", { name: "Choose files" });
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  const start = dialog.getByRole("button", { name: "Start selected download" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(start).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(review).toBeFocused();
  await page.keyboard.press("Enter");
  await keyboardActivate(
    page,
    dialog.getByRole("button", { name: "Select none" }),
  );
  await expect(start).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText(
    "0 of 4 files selected",
  );
  await dialog.getByRole("searchbox", { name: "Search files" }).focus();
  await page.keyboard.type("03-film");
  const file = dialog.getByRole("checkbox", {
    name: "Coastal collection/03-film.mp4",
    exact: true,
  });
  await file.focus();
  await page.keyboard.press("Space");
  await expect(file).toBeChecked();
  await expect(dialog.getByRole("status")).toContainText(
    "1 of 4 files selected",
  );
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await keyboardActivate(page, start);
  await expect(dialog).toHaveCount(0);
  expect(state.selectedFileIds).toEqual(["0"]);
  await expect(
    page.getByRole("heading", { name: "Downloads", exact: true }),
  ).toBeFocused();
  await expect(
    page.locator(".download-row-title").getByRole("status"),
  ).toHaveText("downloading");

  await keyboardActivate(
    page,
    page.getByRole("tab", { name: "Explore", exact: true }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Show sessions" }),
  );
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Open Coastal collection", exact: true }),
  );
  await page
    .getByRole("treeitem", { name: "Coastal collection", exact: true })
    .focus();
  for (const name of filenames.slice(0, 3)) {
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("treeitem", { name, exact: true }),
    ).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect(page.locator("video source")).toHaveAttribute(
    "src",
    /\/api\/sessions\//,
  );
  await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
    video.muted = true;
    await video.play();
    video.pause();
  });
  await expect
    .poll(
      () =>
        page.locator("video").evaluate((video: HTMLVideoElement) => ({
          duration: String(video.duration),
          error: video.error?.message,
          network: video.networkState,
        })),
      { timeout: 15000 },
    )
    .toMatchObject({ duration: "8" });
  const seek = page.getByRole("slider", { name: "Seek video" });
  await expect(seek).toHaveAttribute("max", "8");
  await seek.focus();
  await page.keyboard.press("End");
  await expect(page.locator("video")).toHaveJSProperty("currentTime", 8);
  await keyboardActivate(
    page,
    page.getByRole("button", { name: "Open explorer", exact: true }),
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
