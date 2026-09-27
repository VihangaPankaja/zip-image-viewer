import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { installReviewFixtures, reviewTorrentJob } from "../review/fixtures";

const sessionId = "00000000-0000-4000-8000-000000000008";

async function openCollection(page: Page, mobile = false) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  if (mobile) await page.getByRole("button", { name: "Show sessions" }).click();
  await page
    .getByRole("button", { name: "Open Coastal collection", exact: true })
    .click();
}

test("media filter keeps nested folders, sorting and keyboard preview usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await installReviewFixtures(page);
  await page.route("**/api/sessions/*/tree", (route) =>
    route.fulfill({
      json: {
        id: sessionId,
        firstFilePath: "Season 1/episode-02.txt",
        tree: {
          name: "Coastal collection",
          path: ".",
          type: "directory",
          children: [
            {
              name: "Season 1",
              path: "Season 1",
              type: "directory",
              children: [
                {
                  name: "episode-02.txt",
                  path: "Season 1/episode-02.txt",
                  type: "file",
                  extension: "txt",
                  size: 20,
                },
                {
                  name: "episode-01.txt",
                  path: "Season 1/episode-01.txt",
                  type: "file",
                  extension: "txt",
                  size: 20,
                },
                {
                  name: "cover.png",
                  path: "Season 1/cover.png",
                  type: "file",
                  extension: "png",
                  size: 20,
                },
              ],
            },
            {
              name: "Unused",
              path: "Unused",
              type: "directory",
              children: [
                {
                  name: "sound.wav",
                  path: "Unused/sound.wav",
                  type: "file",
                  extension: "wav",
                  size: 20,
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await openCollection(page, true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Default sort", exact: true }).click();
  await page.getByRole("option", { name: "Name Z-A", exact: true }).click();
  await page.keyboard.press("Escape");
  const filter = page.getByRole("combobox", { name: "Media type" });
  await filter.selectOption("text");
  await expect(
    page.getByRole("treeitem", { name: "Unused", exact: true }),
  ).toHaveCount(0);
  const folder = page.getByRole("treeitem", { name: "Season 1", exact: true });
  await folder.focus();
  await page.keyboard.press("ArrowRight");
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("treeitem", { name: "episode-02.txt", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("treeitem", { name: "episode-01.txt", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("pre")).toContainText("COASTAL COLLECTION");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(filter).toHaveValue("text");
  await filter.selectOption("video");
  await expect(page.getByRole("treeitem")).toHaveCount(0);
  await filter.selectOption("all");
  await expect(
    page.getByRole("treeitem", { name: "Unused", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("torrent media filters preserve hidden selections and scope folder selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  const state = await installReviewFixtures(page);
  state.jobs = [reviewTorrentJob()];
  await page.goto("/");
  await page.getByRole("button", { name: "Review files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose files" });
  await dialog
    .getByRole("combobox", { name: "Media type" })
    .selectOption("video");
  await expect(dialog.getByText("2 of 4 files shown")).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText(
    "4 of 4 files selected",
  );
  const folder = dialog.getByRole("checkbox", {
    name: "Coastal collection",
    exact: true,
  });
  await folder.focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("status")).toContainText(
    "3 of 4 files selected",
  );
  await dialog
    .getByRole("searchbox", { name: "Search files" })
    .fill("unmatched");
  await expect(dialog.getByText("0 of 4 files shown")).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText(
    "3 of 4 files selected",
  );
  await dialog.getByRole("searchbox", { name: "Search files" }).fill("");
  await dialog
    .getByRole("combobox", { name: "Media type" })
    .selectOption("text");
  await expect(
    dialog.getByRole("checkbox", {
      name: "Coastal collection/notes/a-long-field-recording-and-location-notes-filename-for-responsive-review.txt",
      exact: true,
    }),
  ).toBeChecked();
  expect(
    (await new AxeBuilder({ page }).include("dialog").analyze()).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Start selected download" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(state.selectedFileIds).toEqual(["1", "2", "3"]);
});

test("profiles filtering and keyboard navigation with 10,000 files", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "The deterministic large-list profile runs once in Chromium.",
  );
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installReviewFixtures(page);
  const files = Array.from({ length: 10_000 }, (_, index) => ({
    name: `file-${String(index).padStart(5, "0")}.${index % 2 ? "txt" : "wav"}`,
    path: `file-${String(index).padStart(5, "0")}.${index % 2 ? "txt" : "wav"}`,
    type: "file",
    extension: index % 2 ? "txt" : "wav",
    size: 20,
  }));
  await page.route("**/api/sessions/*/tree", (route) =>
    route.fulfill({
      json: {
        id: sessionId,
        firstFilePath: files[1].path,
        tree: {
          name: "Coastal collection",
          path: ".",
          type: "directory",
          children: files,
        },
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  const started = Date.now();
  await page
    .getByRole("button", { name: "Open Coastal collection", exact: true })
    .click();

  await expect(page.locator('[role="treeitem"]')).toHaveCount(10_001, {
    timeout: 30_000,
  });
  const loaded = Date.now();
  await page.getByRole("combobox", { name: "Media type" }).selectOption("text");
  await expect(page.locator('[role="treeitem"]')).toHaveCount(5_001, {
    timeout: 30_000,
  });
  const filtered = Date.now();
  await page.locator('[role="treeitem"]').first().focus();
  await page.keyboard.press("End");
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute(
    "aria-label",
    files[files.length - 1].name,
  );
  expect(errors).toEqual([]);
  const profilePath = testInfo.outputPath("large-file-filter-profile.json");
  await writeFile(
    profilePath,
    JSON.stringify({
      files: 10_000,
      loadAndRenderMs: loaded - started,
      filterAndRenderMs: filtered - loaded,
      keyboardEndMs: Date.now() - filtered,
    }),
  );
  await testInfo.attach("large-file-filter-profile", {
    path: profilePath,
    contentType: "application/json",
  });
});
