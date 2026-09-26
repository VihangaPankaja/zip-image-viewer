import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  filenames,
  installReviewFixtures,
  prepareMedia,
  reviewJobs,
} from "./fixtures";

const output = path.resolve("test-results/pr-screenshots");
const devices = [
  { name: "Mobile", width: 390, height: 844 },
  { name: "Tablet", width: 820, height: 1180 },
  { name: "Desktop", width: 1440, height: 1000 },
  { name: "Ultrawide", width: 2560, height: 1080 },
];
type Capture = {
  device: string;
  width: number;
  height: number;
  theme: string;
  screen: string;
  file: string;
};
const captures: Capture[] = [];

test.beforeAll(async () => {
  await mkdir(output, { recursive: true });
  await prepareMedia();
});
test.afterAll(async () => {
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  await writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(
      {
        sourceCommit,
        fixtures:
          "Deterministic local media and simulated HTTP/torrent progress; not a live network benchmark.",
        captures,
      },
      null,
      2,
    ),
  );
});

async function save(
  page: Page,
  device: (typeof devices)[number],
  theme: string,
  screen: string,
) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const file = `${device.name.toLowerCase()}-${theme}-${screen}.png`;
  await page.screenshot({
    path: path.join(output, file),
    fullPage: screen === "http-and-torrent-downloads",
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
  captures.push({ ...device, device: device.name, theme, screen, file });
}

async function selectFile(page: Page, name: string, mobile: boolean) {
  if (mobile)
    await page
      .getByRole("radio", { name: "Files", exact: true })
      .check({ force: true });
  await page.getByRole("treeitem", { name, exact: true }).click();
  await expect(page.locator(".preview-panel h2")).toHaveText(name);
  if (name.endsWith(".png"))
    await expect(page.locator(".image-frame > img")).toHaveJSProperty(
      "complete",
      true,
    );
  if (name.endsWith(".txt"))
    await expect(page.locator("pre")).toContainText("COASTAL COLLECTION");
  if (name.endsWith(".mp4")) {
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBe(4);
    await page.locator("video").evaluate((video: HTMLVideoElement) => {
      video.pause();
      video.currentTime = 0;
    });
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.seeking),
      )
      .toBe(false);
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBe(4);
    if (mobile) {
      const video = await page.locator("video").boundingBox();
      const navigation = await page
        .locator(".workspace-mobile-nav")
        .boundingBox();
      if (!video || !navigation)
        throw new Error("Mobile player or navigation is missing.");
      expect(video.y + video.height).toBeLessThanOrEqual(navigation.y);
    }
  }
}

async function captureDialogs(
  page: Page,
  device: (typeof devices)[number],
  theme: string,
) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await save(page, device, theme, "settings");
  await page.getByLabel("Show Path column").scrollIntoViewIfNeeded();
  await save(page, device, theme, "settings-more");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Add downloads", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Paste download URLs" })
    .fill(
      "https://downloads.example.com/coastal-collection.zip\nmagnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Open%20film%20collection",
    );
  await page
    .getByRole("heading", { name: "Add downloads", exact: true })
    .click();
  await expect(page.getByLabel("Download URL", { exact: true })).toHaveCount(2);
  await save(page, device, theme, "add-downloads");
  await page.keyboard.press("Escape");
}

for (const device of devices) {
  for (const theme of ["light", "dark"] as const) {
    test(`${device.name} ${theme} review screens`, async ({ page }) => {
      await page.setViewportSize(device);
      await page.emulateMedia({ colorScheme: theme });
      const state = await installReviewFixtures(page);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await save(page, device, theme, "downloads-empty");
      state.jobs = reviewJobs();
      await expect(page.locator(".download-row")).toHaveCount(4);
      await save(page, device, theme, "http-and-torrent-downloads");
      await captureDialogs(page, device, theme);
      state.jobs = [];
      await expect(page.locator(".download-row")).toHaveCount(0);
      await page.getByRole("tab", { name: "Explore" }).click();
      const mobile = device.width <= 760;
      if (mobile)
        await page.getByRole("button", { name: "Show sessions" }).click();
      await page
        .getByRole("button", { name: "Open Coastal collection", exact: true })
        .click();
      await expect(
        page.getByRole("treeitem", { name: filenames[0], exact: true }),
      ).toBeVisible();
      await save(page, device, theme, "explorer");
      for (const name of filenames) {
        await selectFile(page, name, mobile);
        await save(page, device, theme, `preview-${name.split(".").at(-1)}`);
      }
      await selectFile(page, filenames[0], mobile);
      await page
        .getByRole("button", { name: "Slideshow", exact: true })
        .click();
      await save(page, device, theme, "slideshow");
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Open explorer", exact: true })
        .click();
      await save(page, device, theme, "explorer-dialog");
    });
  }
}
