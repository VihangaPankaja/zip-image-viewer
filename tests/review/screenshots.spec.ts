import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  filenames,
  installReviewFixtures,
  prepareMedia,
  reviewJobs,
  reviewTorrentJob,
  reviewActiveTorrentJob,
  reviewSubtitles,
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
  if (name.endsWith(".png")) {
    const image = page.locator(".image-frame > img");
    await expect(image).toHaveJSProperty("naturalWidth", 1200);
    if (mobile) {
      await image.evaluate((element) =>
        element.scrollIntoView({ block: "center" }),
      );
      const bounds = await image.boundingBox();
      const navigation = await page
        .locator(".workspace-mobile-nav")
        .boundingBox();
      if (!bounds || !navigation)
        throw new Error("Mobile image preview is missing.");
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(navigation.y);
    }
  }
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
    await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
      video.muted = true;
      await video.play();
    });
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(0.1);
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
      await page
        .getByRole("slider", { name: "Seek video" })
        .evaluate((control) => control.scrollIntoView({ block: "center" }));
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
      state.jobs = [reviewTorrentJob()];
      await page
        .getByRole("button", { name: "Review files", exact: true })
        .click();
      await page
        .getByRole("checkbox", { name: "Extras", exact: true })
        .uncheck();
      await expect(page.getByRole("dialog").getByRole("status")).toContainText(
        "3 of 4 files selected",
      );
      await save(page, device, theme, "torrent-file-selection");
      await page
        .getByRole("combobox", { name: "Media type" })
        .selectOption("video");
      await expect(page.getByText("2 of 4 files shown")).toBeVisible();
      await save(page, device, theme, "torrent-video-filter");
      await page.getByRole("checkbox", { name: "Extras", exact: true }).check();
      await expect(page.getByRole("dialog").getByRole("status")).toContainText(
        "4 of 4 files selected",
      );
      await save(page, device, theme, "torrent-filter-selection");
      await page
        .getByRole("button", { name: "Start selected download" })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".download-status-message")).toContainText(
        "Downloading selected files",
      );
      await save(page, device, theme, "torrent-selection-started");
      state.jobs = [reviewActiveTorrentJob()];
      await page
        .getByRole("button", { name: "View files", exact: true })
        .click();
      const fileStatus = page.getByRole("combobox", { name: "File status" });
      await expect(page.getByText("4 of 4 files shown")).toBeVisible();
      await expect(page.getByRole("dialog").getByRole("status")).toContainText(
        "3 of 4 files selected",
      );
      await expect(
        page.locator(".torrent-file-state").filter({ hasText: "Downloaded" }),
      ).toHaveCount(1);
      await save(page, device, theme, "torrent-file-states");
      await fileStatus.selectOption("downloading");
      await page
        .getByRole("combobox", { name: "Media type" })
        .selectOption("text");
      await page
        .getByRole("searchbox", { name: "Search files" })
        .fill("location-notes");
      await expect(page.getByText("1 of 4 files shown")).toBeVisible();
      await save(page, device, theme, "torrent-state-filter");
      await page.getByRole("searchbox", { name: "Search files" }).clear();
      await page
        .getByRole("combobox", { name: "Media type" })
        .selectOption("all");
      await fileStatus.selectOption("skipped");
      await expect(page.getByText("1 of 4 files shown")).toBeVisible();
      await save(page, device, theme, "torrent-skipped-files");
      const readyJob = reviewActiveTorrentJob();
      state.jobs = [
        {
          ...readyJob,
          status: "ready",
          phase: "ready",
          percent: 100,
          torrentFiles: readyJob.torrentFiles.map((file) => ({
            ...file,
            complete: file.selected,
            downloadedBytes: file.selected ? file.size : 0,
          })),
        },
      ];
      await fileStatus.selectOption("available");
      await expect(page.getByText("3 of 4 files shown")).toBeVisible();
      await save(page, device, theme, "torrent-available-files");
      await page.keyboard.press("Escape");
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
      const mediaFilter = page.getByRole("combobox", { name: "Media type" });
      await mediaFilter.selectOption("text");
      await expect(
        page.getByRole("treeitem", { name: filenames[0], exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("treeitem", { name: filenames[1], exact: true }),
      ).toBeVisible();
      await save(page, device, theme, "explorer-text-filter");
      await page
        .getByRole("treeitem", { name: filenames[1], exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("pre")).toContainText("COASTAL COLLECTION");
      await save(page, device, theme, "explorer-filter-opened");
      if (mobile)
        await page
          .getByRole("radio", { name: "Files", exact: true })
          .check({ force: true });
      await mediaFilter.selectOption("all");
      for (const name of filenames) {
        await selectFile(page, name, mobile);
        await save(page, device, theme, `preview-${name.split(".").at(-1)}`);
        if (name.endsWith(".mp4")) {
          const seek = page.getByRole("slider", { name: "Seek video" });
          await seek.focus();
          await page.keyboard.down("End");
          await page.keyboard.down("ArrowLeft");
          const thumbnail = page.locator(".video-scrubber-preview img");
          await expect(thumbnail).toBeVisible();
          await expect(thumbnail).toHaveJSProperty("naturalWidth", 1600);
          await expect(seek).toHaveValue("7.75");
          if (mobile) {
            const navigation = await page
              .locator(".workspace-mobile-nav")
              .boundingBox();
            if (!navigation) throw new Error("Mobile navigation is missing.");
            for (const control of [
              seek,
              page.locator(".video-scrubber-preview"),
            ]) {
              const bounds = await control.boundingBox();
              if (!bounds) throw new Error("Video seek evidence is missing.");
              expect(bounds.x).toBeGreaterThanOrEqual(0);
              expect(bounds.y).toBeGreaterThanOrEqual(0);
              expect(bounds.x + bounds.width).toBeLessThanOrEqual(device.width);
              expect(bounds.y + bounds.height).toBeLessThanOrEqual(
                navigation.y,
              );
            }
          }
          await expect(page.locator("video")).toHaveJSProperty(
            "currentTime",
            0,
          );
          await save(page, device, theme, "video-seek-preview");
          await page.keyboard.up("ArrowLeft");
          await page.keyboard.up("End");
          await expect(page.locator("video")).toHaveJSProperty(
            "currentTime",
            7.75,
          );
          await expect
            .poll(() =>
              page
                .locator("video")
                .evaluate(
                  (video: HTMLVideoElement) =>
                    !video.seeking && video.readyState >= 2,
                ),
            )
            .toBe(true);
          await expect(thumbnail).toHaveCount(0);
          await save(page, device, theme, "video-seek-committed");
          const video = page.getByLabel("Video preview");
          const upload = page.getByLabel("Subtitle file", { exact: true });
          await upload.setInputFiles(reviewSubtitles);
          await video.evaluate((element: HTMLVideoElement) => {
            element.currentTime = 2;
          });
          const activeText = () =>
            video.evaluate((element: HTMLVideoElement) =>
              Array.from(element.textTracks)
                .filter((track) => track.mode === "showing")
                .flatMap((track) =>
                  Array.from(track.activeCues ?? []).map(
                    (cue) => (cue as VTTCue).text,
                  ),
                ),
            );
          await expect
            .poll(activeText)
            .toEqual(["Morning light along the coast"]);
          await page.locator(".video-subtitle-note").scrollIntoViewIfNeeded();
          await save(page, device, theme, "video-subtitles-loaded");
          await page
            .getByRole("combobox", { name: "Caption size" })
            .selectOption("large");
          const offset = page.getByRole("spinbutton", {
            name: "Caption offset (seconds)",
          });
          await offset.fill("2");
          await offset.press("Tab");
          await video.evaluate((element: HTMLVideoElement) => {
            element.currentTime = 4;
          });
          await expect
            .poll(activeText)
            .toEqual(["Morning light along the coast"]);
          await page.locator(".video-subtitle-note").scrollIntoViewIfNeeded();
          await save(page, device, theme, "video-subtitles-adjusted");
          await upload.setInputFiles({
            name: "broken.srt",
            mimeType: "text/plain",
            buffer: Buffer.from("1\nnot a timestamp\nInvalid subtitle"),
          });
          await expect(page.getByRole("alert")).toBeVisible();
          await page
            .getByRole("alert")
            .evaluate((element) => element.scrollIntoView({ block: "center" }));
          await save(page, device, theme, "video-subtitles-error");
          await upload.setInputFiles({
            name: "Recovered.vtt",
            mimeType: "text/vtt",
            buffer: Buffer.from(
              "WEBVTT\n\n00:00:00.000 --> 00:00:07.500\nRecovered coastal captions\n",
            ),
          });
          await expect(page.getByRole("alert")).toHaveCount(0);
          await expect.poll(activeText).toEqual(["Recovered coastal captions"]);
          await save(page, device, theme, "video-subtitles-recovered");
        }
      }
      await selectFile(page, filenames[0], mobile);
      await page
        .getByRole("button", { name: "Slideshow", exact: true })
        .click();
      await expect(page.locator(".slideshow-meta")).toContainText("1 / 1");
      await expect(page.locator(".slideshow-stage img")).toHaveJSProperty(
        "naturalWidth",
        1200,
      );
      await save(page, device, theme, "slideshow");
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Open explorer", exact: true })
        .click();
      await save(page, device, theme, "explorer-dialog");
    });
  }
}
