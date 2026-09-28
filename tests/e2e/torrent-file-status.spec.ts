import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  installReviewFixtures,
  reviewActiveTorrentJob,
} from "../review/fixtures";

test.use({ hasTouch: true });

test("torrent file status filters compose without changing selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  const state = await installReviewFixtures(page);
  const job = reviewActiveTorrentJob();
  state.jobs = [job];
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("jobs/selectFiles"))
      mutations.push(request.url());
  });
  await page.goto("/");
  const open = page.getByRole("button", { name: "View files", exact: true });
  await open.tap();
  const dialog = page.getByRole("dialog", { name: "Torrent files" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Start selected download" }),
  ).toHaveCount(0);
  const status = dialog.getByRole("combobox", { name: "File status" });
  const media = dialog.getByRole("combobox", { name: "Media type" });
  const search = dialog.getByRole("searchbox", { name: "Search files" });
  await expect(dialog.getByText("4 of 4 files shown")).toBeVisible();
  await status.selectOption("downloading");
  await expect(dialog.getByText("2 of 4 files shown")).toBeVisible();
  await media.selectOption("text");
  await search.fill("location-notes");
  await expect(dialog.getByText("1 of 4 files shown")).toBeVisible();
  await expect(
    dialog.getByText(/a-long-field-recording-and-location-notes-filename/),
  ).toBeVisible();
  await search.fill("no-such-file");
  await expect(dialog.getByText("0 of 4 files shown")).toBeVisible();
  await search.clear();
  await media.selectOption("all");
  await status.selectOption("skipped");
  await expect(dialog.getByText("1 of 4 files shown")).toBeVisible();
  await expect(
    dialog.getByText("Behind the scenes.mp4", { exact: true }),
  ).toBeVisible();
  await status.selectOption("available");
  await expect(dialog.getByText("0 of 4 files shown")).toBeVisible();
  await status.selectOption("downloaded");
  await expect(dialog.getByText("1 of 4 files shown")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();

  state.jobs = [
    {
      ...job,
      status: "ready",
      phase: "ready",
      percent: 100,
      torrentFiles: job.torrentFiles.map((file) => ({
        ...file,
        complete: file.selected,
        downloadedBytes: file.selected ? file.size : 0,
      })),
    },
  ];
  await page.keyboard.press("Enter");
  await status.selectOption("available");
  await expect(dialog.getByText("3 of 4 files shown")).toBeVisible();
  await status.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(status).toHaveValue("all");
  await expect(dialog.getByText("4 of 4 files shown")).toBeVisible();
  expect(mutations).toEqual([]);
  expect(state.selectedFileIds).toEqual([]);
});
