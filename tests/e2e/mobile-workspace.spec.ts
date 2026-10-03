import { expect, type Page } from "@playwright/test";
import { test } from "./media-fixture";
import { tapVisibleTarget } from "./touch";
import { installReviewFixtures, reviewJobs } from "../review/fixtures";

test.use({ hasTouch: true });
test.setTimeout(60_000);

test("mobile file selection opens preview and retains it across queue visits and rotation", async ({
  page,
}, testInfo) => {
  const sessionId = "00000000-0000-4000-8000-000000000008";
  const filename = `${"long-episode-title-".repeat(15)}.txt`;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.route("**/rpc/sessions/list", (route) =>
    route.fulfill({
      json: {
        json: {
          items: [
            {
              id: sessionId,
              firstFilePath: filename,
              fileCount: 1,
              lastAccessedAt: Date.now(),
            },
          ],
        },
      },
    }),
  );
  await page.route(`**/api/sessions/${sessionId}/tree`, (route) =>
    route.fulfill({
      json: {
        id: sessionId,
        firstFilePath: filename,
        tree: {
          name: filename,
          path: filename,
          extension: "txt",
          type: "file",
          size: 20,
        },
      },
    }),
  );
  await page.route(`**/api/sessions/${sessionId}/file?*`, (route) =>
    route.fulfill({
      contentType: "text/plain",
      body: "Mobile preview fixture",
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(
    page.getByRole("heading", { name: "Sessions", exact: true }),
  ).toBeHidden();
  const sessionsToggle = await page
    .getByRole("button", { name: "Show sessions" })
    .boundingBox();
  expect(sessionsToggle?.height).toBeGreaterThanOrEqual(44);
  expect(sessionsToggle?.height).toBeLessThanOrEqual(60);
  await page.getByRole("button", { name: "Show sessions" }).click();
  await page
    .getByRole("button", { name: `Open ${filename}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Hide sessions" }).click();
  await page.getByRole("treeitem").click();
  await expect(page.getByRole("radio", { name: "Preview" })).toBeChecked();
  await expect(
    page.getByText("Mobile preview fixture", { exact: true }),
  ).toBeVisible();
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 800, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.getByRole("tab", { name: "Downloads" }).click();
    await expect(
      page.getByRole("heading", { name: "Downloads", exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Explore" }).click();
    await expect(page.getByRole("radio", { name: "Preview" })).toBeChecked();
    await page.getByRole("button", { name: "Back to files" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("radio", { name: "Files" })).toBeChecked();
    await page.getByRole("treeitem").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("radio", { name: "Preview" })).toBeChecked();
    const preview = page.getByRole("region", { name: "Preview panel" });
    for (const child of [
      preview.getByRole("heading", { name: filename, exact: true }),
      preview.locator(".preview-toolbar"),
      preview.locator(".panel-actions"),
      preview.locator("pre"),
    ]) {
      const [outer, inner] = await Promise.all([
        preview.boundingBox(),
        child.boundingBox(),
      ]);
      expect(outer).not.toBeNull();
      expect(inner).not.toBeNull();
      if (!outer || !inner) throw new Error("Preview bounds unavailable");
      expect(inner.x).toBeGreaterThanOrEqual(outer.x);
      expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
      expect(inner.y + inner.height).toBeLessThanOrEqual(
        outer.y + outer.height,
      );
    }
    const content = preview.locator("pre");
    await content.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    await expect(content).toBeInViewport({ ratio: 0.99 });
    const [contentBounds, navBounds] = await Promise.all([
      content.boundingBox(),
      page.getByRole("navigation", { name: "Workspace views" }).boundingBox(),
    ]);
    if (!contentBounds || !navBounds)
      throw new Error("Navigation bounds unavailable");
    expect(contentBounds.y).toBeGreaterThanOrEqual(0);
    expect(contentBounds.y + contentBounds.height).toBeLessThanOrEqual(
      navBounds.y,
    );
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${viewport.width}.png`),
      fullPage: true,
      scale: "css",
    });
  }
});

// Catch losing the loaded media element when switching workspace views.
test("loaded mobile video retains seek and paused state across an active queue visit", async ({
  page,
  appOrigin,
}, testInfo) => {
  await openMobileVideo(page, appOrigin);
  const video = page.getByLabel("Video preview");
  const seek = page.getByRole("slider", { name: "Seek video" });
  await expect(seek).toHaveAttribute("max", "8");
  await seek.focus();
  for (const time of [0.25, 0.5, 0.75, 1]) {
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeCloseTo(time, 1);
  }
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeCloseTo(1, 1);
  await page.getByRole("tab", { name: "Downloads" }).click();
  await expect(page.locator(".download-row").first()).toContainText("62%");
  await expect(page.getByLabel("Video preview")).toBeHidden();
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(
    page.getByRole("radio", { name: "Preview", exact: true }),
  ).toBeChecked();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeCloseTo(1, 1);
  await expect(video).toHaveJSProperty("paused", true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-video-return.png"),
    fullPage: true,
  });
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await tapVisibleTarget(
    page
      .getByRole("navigation", { name: "Workspace views" })
      .getByRole("button", { name: "Downloads", exact: true }),
  );
  await expect(video).toHaveJSProperty("paused", false);
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeGreaterThan(1.25);
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(video).toHaveJSProperty("paused", false);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
});

// Catch a queue action disappearing as the phone user scrolls to player controls.
test("mobile playback keeps Downloads within one tap in portrait and landscape", async ({
  page,
  appOrigin,
}, testInfo) => {
  await openMobileVideo(page, appOrigin);
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 800, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    const seek = page.getByRole("slider", { name: "Seek video" });
    await seek.scrollIntoViewIfNeeded();
    await tapVisibleTarget(seek);
    await expect
      .poll(() =>
        page
          .getByLabel("Video preview")
          .evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(3);
    await expect
      .poll(() =>
        page
          .getByLabel("Video preview")
          .evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeLessThan(5);
    const navigation = page.getByRole("navigation", {
      name: "Workspace views",
    });
    const downloads = navigation.getByRole("button", {
      name: "Downloads",
      exact: true,
    });
    await expect(downloads).toBeInViewport({ ratio: 1 });
    const target = await downloads.boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`mobile-video-${viewport.width}.png`),
      fullPage: true,
    });
    await tapVisibleTarget(downloads);
    await expect(
      page.getByRole("heading", { name: "Downloads", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".download-row").first()).toContainText("62%");
    await expect(
      page
        .locator(".download-row")
        .first()
        .getByRole("button", { name: "Pause", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`mobile-active-queue-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Explore" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("radio", { name: "Preview", exact: true }),
    ).toBeChecked();
  }
});

async function openMobileVideo(page: Page, appOrigin: string) {
  await page.setViewportSize({ width: 360, height: 800 });
  const state = await installReviewFixtures(page);
  state.jobs = reviewJobs();
  state.jobs[0].url = `https://downloads.example.com/${"long-download-title-".repeat(15)}.zip`;
  const filename = `${"long-episode-title-".repeat(15)}.mp4`;
  await page.route("**/api/sessions/*/tree", (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-4000-8000-000000000008",
        firstFilePath: filename,
        tree: {
          name: "Mobile media collection",
          path: ".",
          type: "directory",
          children: [filename, "next-audio.wav"].map((name) => ({
            name,
            path: name,
            parentPath: ".",
            extension: name.endsWith(".mp4") ? "mp4" : "wav",
            type: "file",
            size: 2400000,
          })),
        },
      },
    }),
  );
  // Serve MP4 over HTTP with range support for native media in every browser.
  await page.route("**/api/sessions/*/video/play?*", (route) =>
    route.continue(),
  );
  await page.goto(appOrigin);
  await tapVisibleTarget(page.getByRole("tab", { name: "Explore" }));
  await tapVisibleTarget(page.getByRole("button", { name: "Show sessions" }));
  await tapVisibleTarget(
    page.getByRole("button", { name: "Open Coastal collection", exact: true }),
  );
  await tapVisibleTarget(page.getByRole("button", { name: "Hide sessions" }));
  await tapVisibleTarget(
    page.getByRole("treeitem", { name: filename, exact: true }),
  );
  await expect(
    page.getByRole("radio", { name: "Preview", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("heading", { name: filename, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Seek video" }),
  ).toHaveAttribute("max", "8");
  await expect
    .poll(() =>
      page
        .getByLabel("Video preview")
        .evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(2);
}

test("landscape phone can show the entire loaded player above navigation", async ({
  page,
  appOrigin,
}, testInfo) => {
  await openMobileVideo(page, appOrigin);
  for (const viewport of [
    { width: 800, height: 360 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const frame = page.locator(".media-frame");
    await frame.scrollIntoViewIfNeeded();
    await expect(frame).toBeInViewport({ ratio: 0.99 });
    const [playerBounds, videoBounds, navigationBounds] = await Promise.all([
      frame.boundingBox(),
      page.getByLabel("Video preview").boundingBox(),
      page.getByRole("navigation", { name: "Workspace views" }).boundingBox(),
    ]);
    if (!playerBounds || !videoBounds || !navigationBounds)
      throw new Error("Playback bounds unavailable");
    expect(videoBounds.y).toBeGreaterThanOrEqual(playerBounds.y);
    expect(videoBounds.y + videoBounds.height).toBeLessThanOrEqual(
      playerBounds.y + playerBounds.height,
    );
    expect(playerBounds.y + playerBounds.height).toBeLessThanOrEqual(
      navigationBounds.y,
    );
    expect(playerBounds.width).toBeGreaterThan(600);
    await page.screenshot({
      path: testInfo.outputPath(`landscape-player-${viewport.width}.png`),
      fullPage: false,
    });
  }
});

test("phone safe areas keep the header and navigation clear of screen cutouts", async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Chromium CDP provides safe-area emulation.",
  );
  await page.setViewportSize({ width: 360, height: 800 });
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 24, left: 20, right: 20, bottom: 32 },
  });
  await installReviewFixtures(page);
  await page.goto("/");
  await tapVisibleTarget(page.getByRole("tab", { name: "Explore" }));
  const [header, navigation] = await Promise.all([
    page.locator(".workspace-appbar").boundingBox(),
    page.getByRole("navigation", { name: "Workspace views" }).boundingBox(),
  ]);
  if (!header || !navigation) throw new Error("Workspace bounds unavailable");
  expect(header.y).toBeGreaterThanOrEqual(24);
  expect(header.x).toBeGreaterThanOrEqual(20);
  expect(header.x + header.width).toBeLessThanOrEqual(340);
  expect(navigation.x).toBeGreaterThanOrEqual(20);
  expect(navigation.x + navigation.width).toBeLessThanOrEqual(340);
  expect(navigation.y + navigation.height).toBeLessThanOrEqual(768);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-safe-areas.png"),
    fullPage: false,
  });
  await client.detach();
});

test("queue keyboard navigation cannot change the hidden media selection", async ({
  page,
  appOrigin,
}) => {
  await openMobileVideo(page, appOrigin);
  const title = await page.locator(".preview-panel h2").textContent();
  await page.getByRole("tab", { name: "Downloads" }).click();
  await page
    .getByRole("heading", { name: "Downloads", exact: true })
    .evaluate((heading) => {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    });
  for (const key of [
    "ArrowRight",
    "ArrowLeft",
    "Home",
    "End",
    "Space",
    "ArrowUp",
    "]",
  ]) {
    await page.keyboard.press(key);
    await expect(page.locator(".preview-panel h2")).toHaveText(title ?? "");
    await expect(page.getByLabel("Video preview")).toHaveCount(1);
    await expect(page.getByLabel("Video preview")).toHaveJSProperty(
      "paused",
      true,
    );
    await expect(page.getByLabel("Video preview")).toHaveJSProperty(
      "playbackRate",
      1,
    );
  }
});
