import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { tapVisibleTarget } from "./touch";
import {
  installReviewFixtures,
  reviewActiveTorrentJob,
} from "../review/fixtures";

test.use({ hasTouch: true });

for (const width of [360, 1440]) {
  test(`retained torrent adds skipped files with keyboard and touch at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await installReviewFixtures(page);
    const original = reviewActiveTorrentJob();
    state.jobs = [
      {
        ...original,
        status: "ready",
        phase: "ready",
        percent: 100,
        torrentFiles: original.torrentFiles.map((file) => ({
          ...file,
          selected: file.id === "0",
          complete: file.id === "0",
          downloadedBytes: file.id === "0" ? file.size : 0,
        })),
      },
    ];
    await page.goto("/");
    const view = page.getByRole("button", { name: "View files", exact: true });
    if (width === 360) await tapVisibleTarget(view);
    else {
      await view.focus();
      await page.keyboard.press("Enter");
    }
    const add = page.getByRole("button", {
      name: "Download skipped files",
      exact: true,
    });
    await add.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Download skipped files" });
    await expect(
      dialog.getByRole("checkbox", {
        name: "Coastal collection/03-film.mp4",
        exact: true,
      }),
    ).toHaveCount(0);
    const none = dialog.getByRole("button", { name: "Select none" });
    await none.focus();
    await page.keyboard.press("Enter");
    const subtitle = dialog.getByRole("checkbox", {
      name: "Coastal collection/subtitles/English.srt",
      exact: true,
    });
    if (width === 360) await tapVisibleTarget(subtitle);
    else {
      await subtitle.focus();
      await page.keyboard.press("Space");
    }
    await expect(dialog.getByRole("status")).toContainText(
      "1 of 3 files selected",
    );
    expect(
      (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
    ).toEqual([]);
    const start = dialog.getByRole("button", {
      name: "Start selected download",
    });
    await start.focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    expect(state.selectedFileIds).toEqual(["1"]);
    expect(state.jobs[0].torrentFiles.map((file) => file.selected)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(state.jobs[0].torrentFiles[0].complete).toBe(true);
    await expect(view).toBeFocused();
    state.jobs = [
      {
        ...original,
        status: "ready",
        phase: "ready",
        torrentFiles: original.torrentFiles.map((file) => ({
          ...file,
          selected: ["0", "1"].includes(file.id),
          complete: ["0", "1"].includes(file.id),
          downloadedBytes: ["0", "1"].includes(file.id) ? file.size : 0,
        })),
      },
    ];
    await page.reload();
    await view.click();
    await expect(
      page.locator(".torrent-file-state").filter({ hasText: "Available" }),
    ).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(view).toBeFocused();
  });
}

test("reopening the current torrent session refreshes its tree after adding files", async ({
  page,
}) => {
  const state = await installReviewFixtures(page);
  const original = reviewActiveTorrentJob();
  const sessionId = "00000000-0000-4000-8000-000000000008";
  state.jobs = [{ ...original, status: "ready", phase: "ready", sessionId }];
  let names = ["first.txt"];
  await page.route("**/api/sessions/*/tree", (route) =>
    route.fulfill({
      json: {
        id: sessionId,
        firstFilePath: names[0],
        tree: {
          name: "Retained torrent",
          path: ".",
          type: "directory",
          children: names.map((name) => ({
            name,
            path: name,
            parentPath: ".",
            type: "file",
            extension: "txt",
            size: 100,
            modifiedAt: 1,
          })),
        },
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("treeitem", { name: /first.txt/ })).toBeVisible();
  await page.getByRole("tab", { name: "Downloads", exact: true }).click();
  await page.getByRole("button", { name: "View files", exact: true }).click();
  await page
    .getByRole("button", { name: "Download skipped files", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start selected download", exact: true })
    .click();
  names = ["first.txt", "added.txt"];
  state.jobs = [{ ...original, status: "ready", phase: "ready", sessionId }];
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Explore", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("treeitem", { name: /first.txt/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /added.txt/ })).toBeVisible();
});
