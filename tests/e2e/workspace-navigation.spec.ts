import { test, expect } from "@playwright/test";
import { installReviewFixtures, prepareMedia, reviewActiveTorrentJob } from "../review/fixtures";

test("history restores file, session and filters; failed previews recover without changing content", async ({
  page,
}) => {
  const ids = ["00000000-0000-4000-8000-000000000008", "00000000-0000-4000-8000-000000000018"];
  const files = ["a.txt", "b.txt", "picture.png"];
  await installReviewFixtures(page);
  await page.route("**/rpc/sessions/list", (route) =>
    route.fulfill({
      json: {
        json: {
          items: ids.map((id, index) => ({
            id,
            firstFilePath: `${index ? "Second" : "First"} library`,
            fileCount: files.length,
            lastAccessedAt: Date.now(),
          })),
        },
      },
    }),
  );
  let trees = 0;
  await page.route("**/api/sessions/*/tree", (route) => {
    trees++;
    const id = new URL(route.request().url()).pathname.split("/")[3];
    return route.fulfill({
      json: {
        id,
        firstFilePath: files[0],
        tree: {
          name: id === ids[0] ? "First library" : "Second library",
          path: ".",
          type: "directory",
          children: files.map((name) => ({
            name,
            path: name,
            parentPath: ".",
            type: "file",
            extension: name.split(".").at(-1),
            size: 20,
          })),
        },
      },
    });
  });
  let failed = true;
  await page.route("**/api/sessions/*/file?*", (route) => {
    const url = new URL(route.request().url());
    if (failed) return route.fulfill({ status: 503, body: "Temporary fixture failure" });
    const text = `Content of ${url.searchParams.get("path")}`;
    return route.fulfill({
      json: {
        text,
        offset: 0,
        nextOffset: text.length,
        totalBytes: text.length,
        encoding: "utf-8",
        binary: false,
        replacementCharacters: false,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  const sessions = page.getByRole("list", { name: "Sessions", exact: true });
  await sessions.getByRole("button", { name: /First library/ }).click();
  await expect(page.getByRole("alert")).toContainText("Preview unavailable");
  await expect(page.getByRole("link", { name: "Download original", exact: true })).toHaveAttribute(
    "download",
    "",
  );
  failed = false;
  await page.getByRole("button", { name: "Retry preview", exact: true }).click();
  await expect(page.getByText("Content of a.txt", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search explorer files" }).fill(".txt");
  await page.getByRole("combobox", { name: "Media type", exact: true }).selectOption("text");
  await page.getByRole("treeitem", { name: "b.txt txt", exact: true }).click();
  await expect(page.getByText("Content of b.txt", { exact: true })).toBeVisible();
  const beforeBack = trees;
  await page.goBack();
  await expect(page.getByText("Content of a.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search explorer files" })).toHaveValue(".txt");
  await expect(page.getByRole("combobox", { name: "Media type", exact: true })).toHaveValue("text");
  expect(trees).toBe(beforeBack);
  await page.goForward();
  await expect(page.getByText("Content of b.txt", { exact: true })).toBeVisible();
  await sessions.getByRole("button", { name: /Second library/ }).click();
  await expect(page.getByText("Content of a.txt", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Content of b.txt", { exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search explorer files" })).toHaveValue(".txt");
  await page.getByRole("button", { name: "Open explorer", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open explorer", exact: true })).toBeFocused();
});

test("Back, Forward and reload preserve an early torrent video instead of the previous ready session", async ({
  page,
}) => {
  await prepareMedia();
  const state = await installReviewFixtures(page);
  const torrent = reviewActiveTorrentJob();
  state.jobs = [torrent];
  await page.route("**/api/sessions/*/tree", (route) =>
    route.fulfill({
      json: {
        id: new URL(route.request().url()).pathname.split("/")[3],
        firstFilePath: "a.txt",
        tree: {
          name: "Ready library",
          path: ".",
          type: "directory",
          children: [{ name: "a.txt", path: "a.txt", type: "file", extension: "txt" }],
        },
      },
    }),
  );
  await page.route("**/api/sessions/*/file?*", (route) =>
    route.fulfill({
      json: {
        text: "Ready text",
        offset: 0,
        nextOffset: 10,
        totalBytes: 10,
        encoding: "utf-8",
        binary: false,
        replacementCharacters: false,
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  const sessions = page.getByRole("list", { name: "Sessions", exact: true });
  await sessions.getByRole("button", { name: /Ready Coastal collection/ }).click();
  await expect(page.getByText("Ready text", { exact: true })).toBeVisible();
  await sessions.getByRole("button", { name: torrent.torrentFiles[0].path }).click();
  const live = page.getByLabel("Early video preview", { exact: true });
  await expect(live).toHaveCount(1);
  await expect(page).toHaveURL(/jobId/);
  await page.goBack();
  await expect(page.getByText("Ready text", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(live).toHaveCount(1);
  await page.reload();
  await expect(live).toHaveCount(1);
  await expect(page.getByText("Ready text", { exact: true })).toHaveCount(0);
});
