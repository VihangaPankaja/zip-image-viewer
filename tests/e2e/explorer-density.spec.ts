import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { installReviewFixtures, prepareMedia } from "../review/fixtures";
import { setCssViewport } from "./helpers/viewport";
import { tapVisibleTarget } from "./touch";

test.beforeAll(async () => {
  await prepareMedia();
});

test("file rows change density and sidebar resizing stays bounded", async ({ page }) => {
  await installReviewFixtures(page);
  await setCssViewport(page, 1440, 900);
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  await page
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
  const density = page.getByRole("combobox", { name: "Row density" });
  const rows = page.getByRole("treeitem");
  await expect(density).toHaveValue("compact");
  const touchPointer = await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches);
  expect((await rows.first().boundingBox())?.height).toBeCloseTo(touchPointer ? 44 : 36, 3);
  await density.selectOption("comfortable");
  expect((await rows.first().boundingBox())?.height).toBeCloseTo(48, 3);
  await density.selectOption("compact");
  for (const width of [1440, 2560]) {
    await setCssViewport(page, width, 900);
    const separator = page.getByRole("separator");
    await separator.focus();
    await page.keyboard.press("End");
    await expect
      .poll(async () =>
        Math.abs(
          ((await page.getByRole("region", { name: "Explorer sidebar" }).boundingBox())?.width ??
            0) - 480,
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.keyboard.press("Home");
    await expect
      .poll(async () =>
        Math.abs(
          ((await page.getByRole("region", { name: "Explorer sidebar" }).boundingBox())?.width ??
            0) - 260,
        ),
      )
      .toBeLessThanOrEqual(1);
    const handle = await separator.boundingBox();
    if (!handle) throw new Error("Resize handle is missing");
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 30);
    await page.mouse.down();
    await page.mouse.move(handle.x + 200, handle.y + 30, { steps: 5 });
    await page.mouse.up();
    const sidebarWidth = (
      await page.getByRole("region", { name: "Explorer sidebar" }).boundingBox()
    )?.width;
    expect(sidebarWidth).toBeGreaterThan(260);
    expect(sidebarWidth).toBeLessThanOrEqual(481);
  }
  expect(
    (await new AxeBuilder({ page }).include(".workspace-explore-content").analyze()).violations,
  ).toEqual([]);
});

test.describe("touch file drawer", () => {
  test.use({ hasTouch: true });
  test("deep names fit and closing or selecting files restores preview focus", async ({ page }) => {
    await setCssViewport(page, 320, 740);
    await installReviewFixtures(page);
    const name = `${"a-long-filename-".repeat(20)}.txt`;
    const path = `${"deep-directory/".repeat(20)}${name}`;
    let tree: object = { name, path, type: "file", extension: "txt", size: 20 };
    for (let depth = 19; depth >= 0; depth--) {
      tree = {
        name: "deep-directory",
        path: "deep-directory/".repeat(depth + 1).slice(0, -1),
        type: "directory",
        children: [tree],
      };
    }
    await page.route("**/api/sessions/*/tree", (route) =>
      route.fulfill({
        json: {
          id: "00000000-0000-4000-8000-000000000008",
          firstFilePath: path,
          tree: { name: "Coastal collection", path: ".", type: "directory", children: [tree] },
        },
      }),
    );
    await page.goto("/");
    await page.getByRole("tab", { name: "Explore" }).click();
    await tapVisibleTarget(page.getByRole("button", { name: "Show sessions" }));
    await tapVisibleTarget(
      page
        .getByRole("list", { name: "Sessions", exact: true })
        .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ }),
    );
    await tapVisibleTarget(page.getByRole("button", { name: "Hide sessions" }));
    await page.getByRole("searchbox", { name: "Search explorer files" }).fill("a-long-filename");
    const row = page.getByRole("treeitem", {
      name: `${name} ${name.split(".").at(-1)}`,
      exact: true,
    });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toHaveAttribute("title", path);
    expect((await row.boundingBox())?.height).toBeCloseTo(44, 3);
    const geometry = await row.evaluate((element) => {
      const label = element.querySelector(".tree-item-label");
      const meta = element.querySelector(".tree-item-meta");
      if (!label || !meta) throw new Error("Tree row columns are missing");
      return {
        nameWidth: label.clientWidth,
        labelRight: label.getBoundingClientRect().right,
        metaLeft: meta.getBoundingClientRect().left,
        badgeOpacity: getComputedStyle(meta).opacity,
      };
    });
    expect(geometry.nameWidth).toBeGreaterThan(40);
    expect(geometry.labelRight).toBeLessThanOrEqual(geometry.metaLeft);
    expect(geometry.badgeOpacity).toBe("1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await tapVisibleTarget(row);
    const preview = page.getByRole("region", { name: "Preview panel" });
    await expect(preview).toBeFocused();
    await expect(page.getByRole("region", { name: "Explorer sidebar" })).toBeHidden();
    await tapVisibleTarget(page.getByRole("button", { name: "Back to files" }));
    await expect(page.getByRole("region", { name: "Explorer sidebar" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(preview).toBeFocused();
    await tapVisibleTarget(page.getByRole("button", { name: "Back to files" }));
    await tapVisibleTarget(page.getByRole("button", { name: "Close files", exact: true }));
    await expect(preview).toBeFocused();
    const filesRadio = page.getByRole("radio", { name: "Files", exact: true });
    const previewRadio = page.getByRole("radio", { name: "Preview", exact: true });
    await previewRadio.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(filesRadio).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(previewRadio).toBeFocused();
  });
});

test("10,000-file window follows density and responsive row heights", async ({ page }) => {
  test.setTimeout(60_000);
  await installReviewFixtures(page);
  const files = Array.from({ length: 10_000 }, (_, index) => ({
    name: `file-${String(index).padStart(5, "0")}.txt`,
    path: `file-${String(index).padStart(5, "0")}.txt`,
    type: "file",
    extension: "txt",
    size: 20,
  }));
  await page.route("**/api/sessions/*/tree", (route) =>
    route.fulfill({
      json: {
        id: "00000000-0000-4000-8000-000000000008",
        firstFilePath: files[0].path,
        tree: { name: "Coastal collection", path: ".", type: "directory", children: files },
      },
    }),
  );
  await setCssViewport(page, 1440, 900);
  await page.goto("/");
  await page.getByRole("tab", { name: "Explore" }).click();
  await page
    .getByRole("list", { name: "Sessions", exact: true })
    .getByRole("button", { name: /^Ready Coastal collection \d+ files$/ })
    .click();
  const tree = page.getByRole("tree");
  const touchPointer = await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches);
  for (const width of [1440, 390, 820]) {
    await setCssViewport(page, width, 900);
    for (const density of ["comfortable", "compact"]) {
      await page.getByRole("combobox", { name: "Row density" }).selectOption(density);
      await tree.getByRole("treeitem").first().focus();
      await page.keyboard.press("End");
      const last = page.getByRole("treeitem", { name: "file-09999.txt txt", exact: true });
      await expect(last).toBeFocused();
      const height = density === "comfortable" ? 48 : width <= 760 || touchPointer ? 44 : 36;
      await expect.poll(async () => (await last.boundingBox())?.height).toBeCloseTo(height, 3);
      await expect
        .poll(() =>
          tree
            .locator(".tree-window-canvas")
            .evaluate((element) => (element as HTMLElement).offsetHeight),
        )
        .toBe(10_001 * height + 1);
      expect(await tree.getByRole("treeitem").count()).toBeLessThan(100);
      const visible = await last.evaluate((element) => {
        const container = element.closest('[role="tree"]');
        if (!container) throw new Error("Tree viewport is missing");
        const row = element.getBoundingClientRect();
        const clip = container.getBoundingClientRect();
        return row.top >= clip.top && row.bottom <= clip.bottom + 1;
      });
      expect(visible).toBe(true);
      await page.keyboard.press("Home");
      await expect(
        page.getByRole("treeitem", { name: "Coastal collection Folder", exact: true }),
      ).toBeFocused();
    }
  }
  await setCssViewport(page, 1440, 900);
  await tree.getByRole("treeitem").first().focus();
  await page.keyboard.press("End");
  const last = page.getByRole("treeitem", { name: "file-09999.txt txt", exact: true });
  await expect(last).toBeFocused();
  await setCssViewport(page, 390, 900);
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport({ ratio: 0.99 });
  await expect.poll(() => tree.evaluate((element) => element.scrollTop)).toBeGreaterThan(400_000);
  await setCssViewport(page, 1440, 900);
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport({ ratio: 0.99 });
  const search = page.getByRole("searchbox", { name: "Search explorer files" });
  await search.focus();
  await setCssViewport(page, 390, 900);
  await expect(search).toBeFocused();
});
