import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { installReviewFixtures, reviewTorrentJob } from "../review/fixtures";

const sessionId = "00000000-0000-4000-8000-000000000008";

async function expectRowFullyVisible(row: Locator) {
  await expect
    .poll(() =>
      row.evaluate((element) => {
        const rowBounds = element.getBoundingClientRect();
        const tree = element.closest('[role="tree"]');
        if (!tree) return Infinity;
        const clip = tree.getBoundingClientRect();
        return Math.max(
          Math.max(0, clip.top + tree.clientTop) - rowBounds.top,
          rowBounds.bottom -
            Math.min(
              window.innerHeight,
              clip.top + tree.clientTop + tree.clientHeight,
            ),
          Math.max(0, clip.left + tree.clientLeft) - rowBounds.left,
          rowBounds.right -
            Math.min(
              window.innerWidth,
              clip.left + tree.clientLeft + tree.clientWidth,
            ),
        );
      }),
    )
    .toBeLessThanOrEqual(1);
}
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
  await page
    .getByRole("searchbox", { name: "Search explorer files" })
    .fill("Season 1/episode");
  await expect(
    page.getByRole("treeitem", { name: "episode-02.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: "cover.png", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search explorer files" }).clear();
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
}, testInfo) => {
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

  await expect(page.locator('[role="treeitem"]').first()).toBeVisible();
  expect(await page.locator('[role="treeitem"]').count()).toBeLessThan(100);
  const loaded = Date.now();
  const rootRow = page.getByRole("treeitem", {
    name: "Coastal collection",
    exact: true,
  });
  const lastFile = page.getByRole("treeitem", {
    name: files[files.length - 1].name,
    exact: true,
  });
  const unfilteredKeyboardEndMs: Record<string, number> = {};
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion });
    const unfilteredEndStarted = Date.now();
    await rootRow.focus();
    await page.keyboard.press("End");
    await expect(lastFile).toBeFocused();
    await expect(lastFile).toHaveAttribute("aria-posinset", "10000");
    await expect(lastFile).toHaveAttribute("aria-setsize", "10000");
    await expectRowFullyVisible(lastFile);
    unfilteredKeyboardEndMs[reducedMotion] = Date.now() - unfilteredEndStarted;
    await page.keyboard.press("Home");
    await expect(rootRow).toBeFocused();
  }
  const filterStarted = Date.now();
  await page.getByRole("combobox", { name: "Media type" }).selectOption("text");
  await expect(
    page.getByRole("treeitem", { name: "file-00001.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: "file-00001.txt", exact: true }),
  ).toHaveAttribute("aria-setsize", "5000");
  await expect(
    page.getByRole("treeitem", { name: "file-00000.wav", exact: true }),
  ).toHaveCount(0);
  expect(await page.locator('[role="treeitem"]').count()).toBeLessThan(100);
  const filtered = Date.now();
  await page.locator('[role="treeitem"]').first().focus();
  await page.keyboard.press("End");
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute(
    "aria-label",
    files[files.length - 1].name,
  );
  await expectRowFullyVisible(lastFile);
  const keyboardEndMs = Date.now() - filtered;
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute(
    "aria-posinset",
    "5000",
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[role="treeitem"]:focus')).toHaveAttribute(
    "aria-label",
    "file-09997.txt",
  );
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("treeitem", { name: "Coastal collection", exact: true }),
  ).toBeFocused();
  const tree = page.getByRole("tree");
  await tree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("treeitem", { name: "file-09999.txt", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  const profilePath = testInfo.outputPath("large-file-filter-profile.json");
  await writeFile(
    profilePath,
    JSON.stringify({
      files: 10_000,
      loadAndRenderMs: loaded - started,
      filterAndRenderMs: filtered - filterStarted,
      unfilteredKeyboardEndMs,
      keyboardEndMs,
    }),
  );
  await testInfo.attach("large-file-filter-profile", {
    path: profilePath,
    contentType: "application/json",
  });
});

test("profiles torrent selection with 10,000 files", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const state = await installReviewFixtures(page);
  const job = reviewTorrentJob();
  job.torrentFiles = Array.from({ length: 10_000 }, (_, index) => ({
    ...job.torrentFiles[0],
    id: String(index),
    path: `Series/Season ${Math.floor(index / 100)}/${String(index).padStart(5, "0")}.mp4`,
  }));
  state.jobs = [job];
  await page.goto("/");
  const started = Date.now();
  await page.getByRole("button", { name: "Review files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose files" });
  await expect(dialog.getByText("Files 1–200 of 10000")).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(202);
  const loaded = Date.now();
  await dialog.getByRole("button", { name: "Select none" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "0 of 10000 files selected",
  );
  const selected = Date.now();
  await dialog.getByRole("searchbox").fill("Season 50/");
  await expect(dialog.getByRole("checkbox")).toHaveCount(101);
  const profile = {
    files: 10_000,
    loadAndRenderMs: loaded - started,
    clearSelectionMs: selected - loaded,
    filterAndRenderMs: Date.now() - selected,
  };
  console.log("Torrent 10k profile", JSON.stringify(profile));
  await dialog.getByRole("searchbox").clear();
  await dialog
    .getByRole("checkbox", { name: "Series/Season 0", exact: true })
    .focus();
  await page.keyboard.press("End");
  const last = dialog.getByRole("checkbox", {
    name: "Series/Season 99/09999.mp4",
    exact: true,
  });
  await expect(last).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("status")).toContainText(
    "1 of 10000 files selected",
  );
  await page.keyboard.press("Home");
  const firstFolder = dialog.getByRole("checkbox", {
    name: "Series/Season 0",
    exact: true,
  });
  await expect(firstFolder).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("status")).toContainText(
    "101 of 10000 files selected",
  );
  await dialog.getByRole("searchbox").fill("Season 50/");
  const matchFolder = dialog.getByRole("checkbox", {
    name: "Series/Season 50",
    exact: true,
  });
  await expect(matchFolder).not.toBeChecked();
  await matchFolder.focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("status")).toContainText(
    "201 of 10000 files selected",
  );
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Start selected download" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(state.selectedFileIds).toHaveLength(201);
  expect(state.selectedFileIds).toContain("9999");
  expect(state.selectedFileIds).toContain("0");
  expect(state.selectedFileIds).toContain("5099");
  expect(state.selectedFileIds).not.toContain("5100");
  const profilePath = testInfo.outputPath("large-torrent-profile.json");
  await writeFile(profilePath, JSON.stringify(profile));
  await testInfo.attach("large-torrent-profile", {
    path: profilePath,
    contentType: "application/json",
  });
});

test("torrent paging keeps the keyboard Tab stop when a folder spans pages", async ({
  page,
}) => {
  const state = await installReviewFixtures(page);
  const job = reviewTorrentJob();
  job.torrentFiles = Array.from({ length: 1000 }, (_, index) => ({
    ...job.torrentFiles[0],
    id: String(index),
    path: `One folder/episode-${index}.mp4`,
  }));
  state.jobs = [job];
  await page.goto("/");
  await page.getByRole("button", { name: "Review files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose files" });
  await dialog
    .getByRole("checkbox", { name: "One folder", exact: true })
    .focus();
  await page.keyboard.press("End");
  const last = dialog.getByRole("checkbox", {
    name: "One folder/episode-999.mp4",
    exact: true,
  });
  await expect(last).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Start selected download" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("status")).toContainText(
    "999 of 1000 files selected",
  );
});
