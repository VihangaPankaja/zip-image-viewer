import { expect } from "@playwright/test";
import { audioTest, test } from "./media-fixture";
import { installReviewFixtures, reviewActiveTorrentJob, reviewJobs } from "../review/fixtures";
import { tapVisibleTarget } from "./touch";

test.use({ hasTouch: true });

audioTest(
  "closing a live preview stops audio while workspace tabs preserve playback",
  async ({ page, appOrigin, browserName }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await installReviewFixtures(page);
    const torrent = reviewActiveTorrentJob();
    state.jobs = [torrent];
    await page.route("**/rpc/sessions/list", (route) =>
      route.fulfill({ json: { json: { items: [] } } }),
    );
    await page.route("**/api/session-jobs/*/video/stream?*", (route) => route.continue());
    await page.goto(appOrigin);
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Show sessions" }).click();
    for (const backLabel of ["Back to downloads", "Download first"]) {
      await page.getByRole("radio", { name: "Files", exact: true }).check({ force: true });
      await tapVisibleTarget(
        page
          .getByRole("list", { name: "Sessions", exact: true })
          .getByRole("button", { name: torrent.torrentFiles[0].path }),
      );
      const video = page.getByLabel("Early video preview", { exact: true });
      await expect(video).toHaveJSProperty("muted", false);
      // Metadata preload may stop before decoding a frame until the user plays.
      if (browserName === "webkit") await tapVisibleTarget(video);
      else {
        await video.focus();
        await page.keyboard.press("Space");
      }
      await expect(video).toHaveJSProperty("paused", false);
      await expect
        .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
        .toBeGreaterThanOrEqual(2);
      const player = await video.elementHandle();
      await page.getByRole("tab", { name: "Downloads" }).click();
      await expect(video).toHaveJSProperty("paused", false);
      await page.getByRole("tab", { name: "Explore" }).click();
      await tapVisibleTarget(page.getByRole("button", { name: backLabel, exact: true }));
      await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
      await expect(video).toHaveCount(0);
      await expect
        .poll(() =>
          player.evaluate(
            (element: HTMLVideoElement) => element.paused && !element.getAttribute("src"),
          ),
        )
        .toBe(true);
      await page.getByRole("tab", { name: "Explore" }).click();
      await expect(video).toHaveCount(0);
      await player.dispose();
    }
  },
);

test("a newly opened ready session stays usable while the sessions list catches up", async ({
  page,
  appOrigin,
}) => {
  const state = await installReviewFixtures(page);
  const sessionId = "00000000-0000-4000-8000-000000000008";
  const torrent = reviewActiveTorrentJob();
  state.jobs = [{ ...torrent, status: "ready", phase: "ready", sessionId }];
  let requests = 0;
  let releaseStaleResponse = () => {};
  const staleResponse = new Promise<void>((resolve) => {
    releaseStaleResponse = resolve;
  });
  let listed = false;
  await page.route("**/rpc/sessions/list", async (route) => {
    requests += 1;
    if (requests === 2) {
      await staleResponse;
      return route.fulfill({ json: { json: { items: [] } } });
    }
    return route.fulfill({
      json: {
        json: {
          items: listed
            ? [
                {
                  id: sessionId,
                  jobId: torrent.id,
                  firstFilePath: "Coastal collection",
                  fileCount: 6,
                  lastAccessedAt: 0,
                },
              ]
            : [],
        },
      },
    });
  });
  await page.goto(appOrigin);
  await expect.poll(() => requests).toBe(2);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { name: "01-coast.png", exact: true })).toBeVisible();
  await expect(page.getByText("This session is no longer available.", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole("treeitem", { name: /01-coast.png/ })).toBeVisible();
  listed = true;
  releaseStaleResponse();
  await expect.poll(() => requests).toBeGreaterThan(2);
  await expect(page.getByRole("heading", { name: "01-coast.png", exact: true })).toBeVisible();
  const rail = page.getByRole("region", { name: "Sessions", exact: true });
  await expect(
    rail.getByRole("list", { name: "Sessions", exact: true }).getByRole("button"),
  ).toHaveCount(1);
  listed = false;
  await expect(
    page.getByText("This session is no longer available.", { exact: true }),
  ).toBeVisible();
});

test("preview rail filters transfers, opens verified video, recovers and deduplicates completion after restart", async ({
  page,
  appOrigin,
  browserName,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await installReviewFixtures(page);
  // WebKit's native media loader needs a real HTTP range response.
  await page.route("**/api/session-jobs/*/video/stream?*", (route) => route.continue());
  const sessionId = "00000000-0000-4000-8000-000000000008";
  let sessions: {
    id: string;
    jobId?: string;
    firstFilePath: string;
    fileCount: number;
    lastAccessedAt: number;
  }[] = [];
  let sessionsUnavailable = false;
  await page.route("**/rpc/sessions/list", (route) =>
    route.fulfill(sessionsUnavailable ? { status: 503 } : { json: { json: { items: sessions } } }),
  );
  state.jobs = reviewJobs();
  await page.goto(appOrigin);
  await page.getByRole("tab", { name: "Explore" }).click();
  await page.getByRole("button", { name: "Show sessions" }).click();
  const rail = page.getByRole("region", { name: "Sessions", exact: true, includeHidden: true });
  await expect(
    rail.getByRole("list", { name: "Sessions", exact: true }).getByRole("button"),
  ).toHaveCount(0);
  await rail.getByRole("button", { name: "View downloads" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Downloads", exact: true })).toBeVisible();
  const torrent = reviewActiveTorrentJob();
  state.earlyVideo = "download-first";
  state.jobs = [torrent];
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(
    rail.getByRole("list", { name: "Sessions", exact: true }).getByRole("button"),
  ).toHaveCount(0);
  state.earlyVideo = "ready";
  const open = rail
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: torrent.torrentFiles[0].path });
  await expect(open).toBeVisible({ timeout: 20_000 });
  await open.focus();
  await page.keyboard.press("Enter");
  const video = page.getByLabel("Early video preview", { exact: true });
  await expect(video).toBeVisible();
  if (browserName === "webkit") await tapVisibleTarget(video);
  else {
    await video.focus();
    await page.keyboard.press("Space");
  }
  await expect(video).toHaveJSProperty("paused", false);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  state.jobs = [{ ...torrent, phase: "indexing" }];
  for (let index = 0; index < 2; index += 1)
    await page.waitForResponse((response) => response.url().endsWith("/rpc/jobs/list"));
  await expect(video).toBeVisible();
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
  sessions = [
    {
      id: sessionId,
      jobId: torrent.id,
      firstFilePath: "Coastal collection",
      fileCount: 6,
      lastAccessedAt: 0,
    },
  ];
  // The Sessions response arrives while Jobs still has the live torrent without a session ID.
  await expect(page.getByRole("button", { name: "Open ready files" })).toBeVisible();
  await expect(
    rail
      .getByRole("list", { name: "Sessions", exact: true, includeHidden: true })
      .getByRole("button", { includeHidden: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Open ready files" }).click();
  state.jobs = [{ ...torrent, status: "ready", phase: "ready", sessionId }];
  await expect(page.getByLabel("Early video preview")).toHaveCount(0);
  await page.getByRole("radio", { name: "Files", exact: true }).check({ force: true });
  await expect(
    rail.getByRole("list", { name: "Sessions", exact: true }).getByRole("button"),
  ).toHaveCount(1);
  await page.reload();
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(page.getByRole("radio", { name: "Preview", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Back to files", exact: true }).click();
  await page.getByRole("button", { name: "Show sessions" }).click();
  await expect(
    rail.getByRole("list", { name: "Sessions", exact: true }).getByRole("button"),
  ).toHaveCount(1);
  await rail
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
  await page.getByRole("radio", { name: "Preview", exact: true }).check({ force: true });
  sessions = [];
  await expect(
    page.getByText("This session is no longer available.", { exact: true }),
  ).toBeVisible();
  sessionsUnavailable = true;
  // Observe a second failed refresh after React has processed the first one.
  for (let index = 0; index < 2; index += 1)
    await page.waitForResponse(
      (response) => response.url().endsWith("/rpc/sessions/list") && response.status() === 503,
    );
  await expect(
    page.getByText("This session is no longer available.", { exact: true }),
  ).toBeVisible();
});

test("a failed session switch clears files, metadata and storage ownership", async ({
  page,
  appOrigin,
}) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  const state = await installReviewFixtures(page);
  state.jobs = [];
  const sessionId = "00000000-0000-4000-8000-000000000009";
  await page.route("**/rpc/sessions/list", (route) =>
    route.fulfill({
      json: {
        json: {
          items: [
            {
              id: "00000000-0000-4000-8000-000000000008",
              firstFilePath: "Coastal collection",
              fileCount: 6,
              lastAccessedAt: 0,
            },
            {
              id: sessionId,
              firstFilePath: "Unavailable collection",
              fileCount: 1,
              lastAccessedAt: 0,
            },
          ],
        },
      },
    }),
  );
  let invalid = false;
  await page.route(`**/api/sessions/${sessionId}/tree`, (route) =>
    route.fulfill(
      invalid ? { json: { id: sessionId, tree: { type: "invalid" } } } : { status: 404 },
    ),
  );
  await page.goto(appOrigin);
  await page.getByRole("tab", { name: "Explore" }).click();
  const rail = page.getByRole("region", { name: "Sessions", exact: true });
  for (const malformed of [false, true]) {
    invalid = malformed;
    await rail
      .getByRole("list", { name: "Sessions", exact: true })
      .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
      .click();
    await expect(page.getByRole("treeitem", { name: /01-coast.png/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Storage", exact: true })).toBeVisible();
    await rail
      .getByRole("list", { name: "Sessions", exact: true })
      .getByRole("button", { name: /^Ready Unavailable collection \d+ files$/ })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      malformed
        ? "This session returned invalid data. Check Downloads or try again."
        : "This preview is no longer available. Check Downloads or choose another session.",
    );
    await expect(page.getByRole("treeitem")).toHaveCount(0);
    await expect(page.getByText("No file selected", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Storage", exact: true })).toHaveCount(0);
  }
  await rail
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
  await expect(page.getByRole("heading", { name: "01-coast.png", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Storage", exact: true })).toBeVisible();
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
  await expect(
    rail.getByRole("list", { name: "Sessions", exact: true }).getByRole("button"),
  ).toHaveCount(1);
  await page.route("**/api/sessions/*/tree", (route) => route.fulfill({ status: 404 }));
  await rail
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
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
