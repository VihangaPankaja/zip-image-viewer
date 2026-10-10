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
    fullPage:
      screen === "http-and-torrent-downloads" ||
      screen === "loaded-video-downloads-visit",
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });
  captures.push({ ...device, device: device.name, theme, screen, file });
}

async function installSearchTree(page: Page) {
  const modifiedAt = Date.UTC(2026, 0, 15, 12);
  await page.route("**/rpc/sessions/list", (route) =>
    route.fulfill({
      json: {
        json: {
          items: [
            {
              id: "00000000-0000-4000-8000-000000000008",
              firstFilePath: "Coastal collection",
              fileCount: filenames.length + 2,
              lastAccessedAt: modifiedAt,
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/sessions/*/tree", (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    const file = (name: string, parentPath = ".") => ({
      name,
      path: parentPath === "." ? name : `${parentPath}/${name}`,
      parentPath,
      type: "file",
      extension: name.split(".").at(-1),
      size: 2400000,
      modifiedAt,
    });
    return route.fulfill({
      json: {
        id,
        firstFilePath: filenames[0],
        tree: {
          name: "Coastal collection",
          path: ".",
          type: "directory",
          children: [
            ...filenames.map((name) => file(name)),
            {
              name: "Field notes",
              path: "Field notes",
              type: "directory",
              children: ["north-shore", "south-shore"].map((name) => ({
                name,
                path: `Field notes/${name}`,
                parentPath: "Field notes",
                type: "directory",
                children: [file("location-notes.txt", `Field notes/${name}`)],
              })),
            },
          ],
        },
      },
    });
  });
}

async function resizeExplorer(page: Page, targetX: number) {
  const handle = await page.locator(".workspace-resize-handle").boundingBox();
  if (!handle) throw new Error("Explorer resize handle is missing.");
  const centerX = handle.x + handle.width / 2;
  const centerY = handle.y + Math.min(handle.height / 2, 200);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(targetX, centerY, { steps: 10 });
  await page.mouse.up();
  return centerX;
}

async function widenTabletExplorer(page: Page) {
  const group = await page.locator(".workspace-panel-group").boundingBox();
  if (!group) throw new Error("Explorer panel group is missing.");
  return resizeExplorer(page, group.x + group.width * 0.53);
}

async function captureExplorerSearch(
  page: Page,
  device: (typeof devices)[number],
  theme: string,
  mobile: boolean,
) {
  const originalDivider =
    device.name === "Tablet" ? await widenTabletExplorer(page) : undefined;
  if (mobile) {
    await page
      .getByRole("radio", { name: "Files", exact: true })
      .check({ force: true });
    await page
      .getByRole("button", { name: "Hide sessions", exact: true })
      .click();
  }
  const search = page.getByRole("searchbox", { name: "Search explorer files" });
  await search.fill("Field notes/");
  const results = page.getByRole("treeitem", {
    name: "location-notes.txt",
    exact: true,
    includeHidden: true,
  });
  await expect(results).toHaveCount(2);
  if (device.name === "Tablet")
    for (const result of [results.first(), results.last()])
      expect(
        await result
          .locator(".tree-item-label")
          .evaluate((label) => label.scrollWidth <= label.clientWidth),
      ).toBe(true);
  for (const name of ["Field notes", "north-shore", "south-shore"])
    await expect(
      page.getByRole("treeitem", { name, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("treeitem", { name: filenames[0], exact: true }),
  ).toHaveCount(0);
  if (mobile) {
    const navigation = await page
      .locator(".workspace-mobile-nav")
      .boundingBox();
    if (!navigation) throw new Error("Mobile navigation is missing.");
    for (const result of [results.first(), results.last()]) {
      await expect(result).toBeInViewport({ ratio: 1 });
      const bounds = await result.boundingBox();
      if (!bounds) throw new Error("Explorer search result is missing.");
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(navigation.y);
    }
  }
  await save(page, device, theme, "explorer-path-search");
  await results.first().focus();
  await page.keyboard.press("End");
  await expect(results.last()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(results.first()).toBeFocused();
  await save(page, device, theme, "explorer-search-keyboard-focused");
  await page.keyboard.press("Enter");
  await expect(page.locator(".preview-panel h2")).toHaveText(
    "location-notes.txt",
  );
  await expect(page.locator("pre")).toContainText("COASTAL COLLECTION");
  await expect(page.locator(".workspace-metadata-panel")).toContainText(
    "Field notes/north-shore/location-notes.txt",
  );
  await expect(results.first()).toHaveAttribute("aria-selected", "true");
  await save(page, device, theme, "explorer-search-keyboard-opened");
  if (mobile)
    await page
      .getByRole("radio", { name: "Files", exact: true })
      .check({ force: true });
  await search.clear();
  await expect(
    page.getByRole("treeitem", { name: filenames[0], exact: true }),
  ).toBeVisible();
  await expect(results).toHaveCount(0);
  if (originalDivider !== undefined)
    await resizeExplorer(page, originalDivider);
}

async function captureVideoQueueReturn(
  page: Page,
  device: (typeof devices)[number],
  theme: string,
  state: Awaited<ReturnType<typeof installReviewFixtures>>,
  mobile: boolean,
) {
  const video = page.locator("video");
  const seek = page.getByRole("slider", { name: "Seek video" });
  await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveJSProperty("currentTime", 7.75);
  state.jobs = reviewJobs();
  if (mobile) {
    await page
      .locator(".video-subtitle-note")
      .evaluate((element) => element.scrollIntoView({ block: "end" }));
    const downloads = page
      .getByRole("navigation", { name: "Workspace views" })
      .getByRole("button", { name: "Downloads", exact: true });
    await expect(downloads).toBeInViewport({ ratio: 1 });
    await downloads.click();
  } else {
    await page.getByRole("tab", { name: "Downloads", exact: true }).click();
  }
  await expect(page.locator(".download-row")).toHaveCount(4);
  await expect(video).toBeHidden();
  await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveJSProperty("currentTime", 7.75);
  await save(page, device, theme, "loaded-video-downloads-visit");
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await expect(video).toBeVisible();
  await expect(video).toHaveJSProperty("paused", true);
  await expect(video).toHaveJSProperty("currentTime", 7.75);
  await expect(video).toHaveJSProperty("readyState", 4);
  await expect(page.locator(".preview-panel h2")).toHaveText(filenames[2]);
  await expect(seek).toHaveValue("7.75");
  if (device.name === "Desktop" || device.name === "Tablet") {
    await video.evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    await expect(video).toBeInViewport({ ratio: 1 });
    await expect(seek).toBeInViewport({ ratio: 1 });
  } else {
    await seek.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    if (mobile) await expect(seek).toBeInViewport({ ratio: 1 });
  }
  await save(page, device, theme, "video-return-paused-position");
  state.jobs = [];
}

async function captureLargeTorrent(
  page: Page,
  device: (typeof devices)[number],
  theme: string,
  state: Awaited<ReturnType<typeof installReviewFixtures>>,
) {
  const job = reviewTorrentJob();
  job.torrentFiles = Array.from({ length: 10_000 }, (_, index) => ({
    ...job.torrentFiles[0],
    id: String(index),
    path: `Coastal collection/film-${String(index).padStart(5, "0")}.mp4`,
  }));
  job.reportedSize = job.torrentFiles.reduce(
    (size, file) => size + file.size,
    0,
  );
  state.jobs = [job];
  await page.getByRole("button", { name: "Review files", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose files" });
  await expect(
    dialog.getByText("Files 1–200 of 10000", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText(
    "10000 of 10000 files selected",
  );
  await expect(dialog.getByRole("checkbox")).toHaveCount(201);
  await save(page, device, theme, "torrent-large-folder-page");
  await dialog
    .getByRole("button", { name: "Select none", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "0 of 10000 files selected",
  );
  await dialog
    .getByRole("checkbox", { name: "Coastal collection", exact: true })
    .check();
  await expect(dialog.getByRole("status")).toContainText(
    "10000 of 10000 files selected",
  );
  await dialog.getByRole("button", { name: "Next files", exact: true }).click();
  await expect(
    dialog.getByText("Files 201–400 of 10000", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", {
      name: "Coastal collection/film-00200.mp4",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "Coastal collection", exact: true }),
  ).toBeChecked();
  await expect(dialog.getByRole("status")).toContainText(
    "10000 of 10000 files selected",
  );
  await save(page, device, theme, "torrent-large-folder-selection");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  state.jobs = [reviewTorrentJob()];
}

async function captureLargeExplorer(
  page: Page,
  device: (typeof devices)[number],
  theme: string,
  mobile: boolean,
) {
  const id = "00000000-0000-4000-8000-000000000008";
  const files = Array.from({ length: 10_000 }, (_, index) => {
    const name = `location-notes-${String(index).padStart(5, "0")}.txt`;
    return {
      name,
      path: name,
      parentPath: ".",
      type: "file",
      extension: "txt",
      size: 12000,
    };
  });
  const treeRoute = "**/api/sessions/*/tree";
  const sessionsRoute = "**/rpc/sessions/list";
  const treeHandler: Parameters<Page["route"]>[1] = (route) =>
    route.fulfill({
      json: {
        id,
        firstFilePath: files[0].path,
        tree: {
          name: "Coastal collection",
          path: ".",
          type: "directory",
          children: files,
        },
      },
    });
  const sessionsHandler: Parameters<Page["route"]>[1] = (route) =>
    route.fulfill({
      json: {
        json: {
          items: [
            {
              id,
              firstFilePath: "Coastal collection",
              fileCount: files.length,
              lastAccessedAt: Date.UTC(2026, 0, 15, 12),
            },
          ],
        },
      },
    });
  await page.route(treeRoute, treeHandler);
  await page.route(sessionsRoute, sessionsHandler);
  try {
    await page.reload();
    await page.getByRole("tab", { name: "Explore", exact: true }).click();
    if (mobile)
      await page.getByRole("button", { name: "Show sessions" }).click();
    await page
      .getByRole("button", { name: "Open Coastal collection", exact: true })
      .click();
    await expect(page.locator(".explorer-tree-panel .panel-chip")).toHaveText(
      "10000",
    );
    if (device.name === "Tablet") await widenTabletExplorer(page);
    const tree = page.getByRole("tree", { name: "Explorer tree" });
    await tree.getByRole("treeitem").first().focus();
    await page.keyboard.press("End");
    const last = tree.getByRole("treeitem", {
      name: files[9999].name,
      exact: true,
    });
    await expect(last).toBeFocused();
    await expect(last).toBeVisible();
    await expect(last).toHaveAttribute("aria-posinset", "10000");
    if (device.name === "Tablet")
      expect(
        await last
          .locator(".tree-item-label")
          .evaluate((label) => label.scrollWidth <= label.clientWidth),
      ).toBe(true);
    expect(await tree.getByRole("treeitem").count()).toBeLessThan(100);
    if (mobile) {
      await last.evaluate((element) =>
        element.scrollIntoView({ block: "center" }),
      );
      const item = await last.boundingBox();
      const navigation = await page
        .locator(".workspace-mobile-nav")
        .boundingBox();
      if (!item || !navigation)
        throw new Error("Large collection or mobile navigation is missing.");
      expect(item.y + item.height).toBeLessThanOrEqual(navigation.y);
    }
    await save(page, device, theme, "explorer-large-collection");
  } finally {
    await page.unroute(treeRoute, treeHandler);
    await page.unroute(sessionsRoute, sessionsHandler);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Downloads", exact: true }),
    ).toBeVisible();
  }
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
  if (name.endsWith(".mp4") || name.endsWith(".mkv")) {
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
  state: Awaited<ReturnType<typeof installReviewFixtures>>,
) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await save(page, device, theme, "settings");
  await page.getByLabel("Show Path column").scrollIntoViewIfNeeded();
  await save(page, device, theme, "settings-more");
  await page
    .getByRole("spinbutton", { name: "Torrent download limit (KiB/s)" })
    .fill("512");
  await page
    .getByRole("spinbutton", { name: "Torrent upload limit (KiB/s)" })
    .fill("128");
  await page.getByRole("button", { name: "Save torrent limits" }).click();
  await expect
    .poll(() => state.torrentLimits)
    .toEqual({
      downloadBytesPerSec: 512 * 1024,
      uploadBytesPerSec: 128 * 1024,
    });
  await expect(
    page.getByRole("button", { name: "Save torrent limits" }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Torrent download limit (KiB/s)" }),
  ).toHaveValue("512");
  await expect(
    page.getByRole("spinbutton", { name: "Torrent upload limit (KiB/s)" }),
  ).toHaveValue("128");
  await page
    .getByRole("group", { name: "Torrent bandwidth" })
    .scrollIntoViewIfNeeded();
  await save(page, device, theme, "torrent-transfer-limits");
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
  await page.getByRole("button", { name: "Add to queue", exact: true }).focus();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "2 of 50 ready",
  );
  await save(page, device, theme, "download-keyboard-announcement");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Add downloads", exact: true }),
  ).toBeFocused();
  await save(page, device, theme, "download-focus-returned");
}

async function captureResourceRejection(
  page: Page,
  device: (typeof devices)[number],
  theme: string,
  state: Awaited<ReturnType<typeof installReviewFixtures>>,
) {
  const jobs = state.jobs;
  const failed = jobs[0];
  state.jobs = [
    {
      ...failed,
      status: "error",
      phase: "error",
      message: "Insufficient storage for this download or extraction.",
      canPause: false,
    },
    ...jobs.slice(1),
  ];
  await expect(
    page.getByText("Insufficient storage for this download or extraction."),
  ).toBeVisible();
  await save(page, device, theme, "download-storage-rejected");
  state.jobs = jobs;
  await expect(
    page.getByText("Insufficient storage for this download or extraction."),
  ).toHaveCount(0);
}

for (const device of devices) {
  for (const theme of ["light", "dark"] as const) {
    test(`${device.name} ${theme} review screens`, async ({ page }) => {
      await page.setViewportSize(device);
      await page.emulateMedia({ colorScheme: theme });
      const state = await installReviewFixtures(page);
      await installSearchTree(page);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await save(page, device, theme, "downloads-empty");
      state.jobs = reviewJobs();
      await expect(page.locator(".download-row")).toHaveCount(4);
      await save(page, device, theme, "http-and-torrent-downloads");
      await captureResourceRejection(page, device, theme, state);
      await captureDialogs(page, device, theme, state);
      await captureLargeTorrent(page, device, theme, state);
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
      const lastTorrentFile = page.getByRole("checkbox", {
        name: "Extras/Behind the scenes.mp4",
        exact: true,
      });
      await page
        .getByRole("checkbox", {
          name: "Coastal collection/03-film.mp4",
          exact: true,
        })
        .focus();
      await page.keyboard.press("End");
      await expect(lastTorrentFile).toBeFocused();
      await page.keyboard.press("Space");
      await expect(lastTorrentFile).toBeChecked();
      await expect(page.getByRole("dialog").getByRole("status")).toContainText(
        "4 of 4 files selected",
      );
      await save(page, device, theme, "torrent-keyboard-selection");
      await page.keyboard.press("Space");
      await expect(lastTorrentFile).not.toBeChecked();
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
      const priority = page.getByRole("combobox", {
        name: "Priority for Coastal collection/subtitles/English.srt",
      });
      await priority.selectOption("high");
      await expect
        .poll(
          () =>
            state.jobs[0]?.torrentFiles.find(({ id }) => id === "1")?.priority,
        )
        .toBe("high");
      await expect(priority).toHaveValue("high");
      await save(page, device, theme, "torrent-priority-changed");
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
      await page
        .getByRole("button", { name: "Download skipped files", exact: true })
        .click();
      await expect(
        page.getByRole("checkbox", {
          name: "Extras/Behind the scenes.mp4",
          exact: true,
        }),
      ).toBeChecked();
      await expect(page.getByRole("dialog").getByRole("status")).toContainText(
        "1 of 1 files selected",
      );
      await save(page, device, theme, "torrent-download-skipped-selection");
      await page
        .getByRole("button", { name: "Start selected download" })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await save(page, device, theme, "torrent-download-skipped-started");
      state.jobs = [
        {
          ...readyJob,
          status: "ready",
          phase: "ready",
          percent: 100,
          message:
            "All four retained files are ready. Transfer progress is simulated.",
          torrentFiles: readyJob.torrentFiles.map((file) => ({
            ...file,
            selected: true,
            complete: true,
            downloadedBytes: file.size,
          })),
        },
      ];
      await page
        .getByRole("button", { name: "View files", exact: true })
        .click();
      await expect(
        page.locator(".torrent-file-state").filter({ hasText: "Available" }),
      ).toHaveCount(4);
      await save(page, device, theme, "torrent-retained-files-ready");
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
      await captureExplorerSearch(page, device, theme, mobile);
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
        await save(
          page,
          device,
          theme,
          name.endsWith(".mkv")
            ? "video-remux-playback"
            : `preview-${name.split(".").at(-1)}`,
        );
        if (name.endsWith(".mkv")) {
          await expect(
            page.getByText("Mode: Remux", { exact: true }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Transcode instead" }).click();
          await expect
            .poll(() =>
              page
                .locator("video")
                .evaluate((video: HTMLVideoElement) => video.readyState),
            )
            .toBeGreaterThanOrEqual(3);
          await page
            .locator("video")
            .evaluate(async (video: HTMLVideoElement) => {
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
          await page
            .locator("video")
            .evaluate((video: HTMLVideoElement) => video.pause());
          await expect(
            page.getByText("Mode: Transcode", { exact: true }),
          ).toBeVisible();
          await save(page, device, theme, "video-transcode-fallback");
        }
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
          await captureVideoQueueReturn(page, device, theme, state, mobile);
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
          await page
            .locator(".video-subtitle-note")
            .evaluate((element) => element.scrollIntoView({ block: "end" }));
          await page.evaluate(
            (offset) => window.scrollBy(0, offset),
            device.name === "Mobile" ? 96 : 32,
          );
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
          await page
            .locator(".video-subtitle-note")
            .evaluate((element) => element.scrollIntoView({ block: "end" }));
          await page.evaluate(
            (offset) => window.scrollBy(0, offset),
            device.name === "Mobile" ? 96 : 32,
          );
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
      let releaseProbe!: () => void;
      const pendingProbe = new Promise<void>((resolve) => {
        releaseProbe = resolve;
      });
      await page.route("**/rpc/video/qualities", async (route) => {
        await pendingProbe;
        await route.fulfill({ status: 500, json: { error: "Probe failed" } });
      });
      try {
        if (mobile)
          await page
            .getByRole("radio", { name: "Files", exact: true })
            .check({ force: true });
        await page
          .getByRole("treeitem", { name: filenames[2], exact: true })
          .click();
        await expect(page.locator(".preview-panel h2")).toHaveText(
          filenames[2],
        );
        const video = page.getByLabel("Video preview");
        await expect(video).toHaveJSProperty("paused", true);
        await expect(video).toHaveJSProperty("readyState", 0);
        await expect(video.locator("source")).toHaveCount(0);
        if (mobile)
          await page
            .getByRole("radio", { name: "Preview", exact: true })
            .check({ force: true });
        await video.scrollIntoViewIfNeeded();
        await save(page, device, theme, "video-qualities-pending");
        releaseProbe();
        await expect(
          page.getByText("Mode: Original file", { exact: true }),
        ).toBeVisible();
        await expect(video).toHaveJSProperty("readyState", 4);
        await video.evaluate(async (element: HTMLVideoElement) => {
          element.muted = true;
          await element.play();
        });
        await expect
          .poll(() =>
            video.evaluate((element: HTMLVideoElement) => element.currentTime),
          )
          .toBeGreaterThan(0.1);
        await video.evaluate((element: HTMLVideoElement) => element.pause());
        await save(page, device, theme, "video-probe-fallback");
      } finally {
        releaseProbe();
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
      await page.keyboard.press("Escape");
      await captureLargeExplorer(page, device, theme, mobile);
    });
  }
}
