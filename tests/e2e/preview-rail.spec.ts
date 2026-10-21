import { expect } from "@playwright/test";
import { test } from "./media-fixture";
import { installReviewFixtures, reviewActiveTorrentJob, reviewJobs } from "../review/fixtures";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });

test("preview rail filters transfers, opens verified video, recovers and deduplicates completion after restart", async ({
  page,
  appOrigin,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await installReviewFixtures(page);
  // WebKit's native media loader needs a real HTTP range response.
  await page.route("**/api/session-jobs/*/video/stream?*", (route) => route.continue());
  const sessionId = "00000000-0000-4000-8000-000000000008";
  let sessions: { id: string; firstFilePath: string; fileCount: number; lastAccessedAt: number }[] =
    [];
  await page.route("**/rpc/sessions/list", (route) =>
    route.fulfill({ json: { json: { items: sessions } } }),
  );
  state.jobs = reviewJobs();
  await page.goto(appOrigin);
  await page.getByRole("tab", { name: "Explore" }).click();
  await page.getByRole("button", { name: "Show sessions" }).click();
  const rail = page.getByRole("region", { name: "Sessions", exact: true });
  await expect(rail.getByRole("button", { name: /^Open / })).toHaveCount(0);
  await rail.getByRole("button", { name: "View downloads" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
  const torrent = reviewActiveTorrentJob();
  state.earlyVideo = "download-first";
  state.jobs = [torrent];
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(rail.getByRole("button", { name: /^Open / })).toHaveCount(0);
  state.earlyVideo = "ready";
  const open = rail.getByRole("button", {
    name: `Open ${torrent.torrentFiles[0].path}`,
    exact: true,
  });
  await expect(open).toBeVisible({ timeout: 20_000 });
  await open.focus();
  await page.keyboard.press("Enter");
  const video = page.getByLabel("Early video preview", { exact: true });
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  state.jobs = [{ ...torrent, status: "paused" }];
  await expect(
    page.getByText("This live preview is no longer available.", { exact: true }),
  ).toBeVisible();
  await expect(video).toHaveCount(0);
  await tapVisibleTarget(
    page
      .getByRole("region", { name: "Preview panel" })
      .getByRole("button", { name: "View downloads" }),
  );
  await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
  state.jobs = [torrent];
  await page.getByRole("tab", { name: "Explore" }).click();
  await page.getByRole("radio", { name: "Files", exact: true }).check({ force: true });
  await expect(open).toBeVisible({ timeout: 20_000 });
  await tapVisibleTarget(open);
  state.jobs = [{ ...torrent, status: "ready", phase: "ready", sessionId }];
  sessions = [
    { id: sessionId, firstFilePath: "Coastal collection", fileCount: 6, lastAccessedAt: 0 },
  ];
  await page.getByRole("button", { name: "Open ready files" }).click();
  await expect(page.getByLabel("Early video preview")).toHaveCount(0);
  await page.getByRole("radio", { name: "Files", exact: true }).check({ force: true });
  await expect(rail.getByRole("button", { name: /^Open / })).toHaveCount(1);
  await page.reload();
  await page.getByRole("tab", { name: "Explore" }).click();
  await page.getByRole("button", { name: "Show sessions" }).click();
  await expect(rail.getByRole("button", { name: /^Open / })).toHaveCount(1);
  await rail.getByRole("button", { name: "Open Coastal collection", exact: true }).click();
  await page.getByRole("radio", { name: "Preview", exact: true }).check({ force: true });
  sessions = [];
  await expect(
    page.getByText("This session is no longer available.", { exact: true }),
  ).toBeVisible();
});

test("invalid video capability and failed session loads offer recovery without openable transfer cards", async ({
  page,
}) => {
  const state = await installReviewFixtures(page);
  state.jobs = [reviewActiveTorrentJob()];
  await page.route("**/api/session-jobs/*/video/info?*", (route) =>
    route.fulfill({ json: { state: "ready" } }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  const rail = page.getByRole("region", { name: "Sessions", exact: true });
  await expect(rail.getByRole("button", { name: /^Open / })).toHaveCount(1);
  await page.route("**/api/sessions/*/tree", (route) => route.fulfill({ status: 404 }));
  await rail.getByRole("button", { name: "Open Coastal collection", exact: true }).click();
  await expect(
    page.getByText(
      "This preview is no longer available. Check Downloads or choose another session.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "Preview panel" })
    .getByRole("button", { name: "View downloads" })
    .click();
  await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
});
