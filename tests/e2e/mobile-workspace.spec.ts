import { expect, test } from "@playwright/test";

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
