import { expect, type Locator } from "@playwright/test";

export async function tapVisibleTarget(target: Locator) {
  const page = target.page();
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Touch verification requires a viewport.");
  const size = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  if (
    viewport.width === size.width &&
    Math.abs(viewport.height - size.height) <= 1
  ) {
    await target.tap();
    return;
  }
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "center" });
    return new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          ),
        );
      }),
    )
    .toBe(true);
  const point = await target.evaluate((element, size) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    if (!element.contains(document.elementFromPoint(x, y))) {
      throw new Error("The touch target is covered by another element.");
    }
    document.documentElement.dataset.e2eTouch = "pending";
    document.addEventListener(
      "touchstart",
      (event) => {
        document.documentElement.dataset.e2eTouch =
          event.isTrusted &&
          event.target instanceof Node &&
          element.contains(event.target)
            ? "received"
            : "missed";
      },
      { once: true, capture: true },
    );
    // Windows WebKit applies host display scaling to native touch coordinates.
    // A standard viewport maps one CSS pixel to one native coordinate.
    return {
      x: (x * size.width) / innerWidth,
      y: (y * size.height) / innerHeight,
    };
  }, viewport);
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator("html")).toHaveAttribute(
    "data-e2e-touch",
    "received",
  );
  await page
    .locator("html")
    .evaluate((element) => delete (element as HTMLElement).dataset.e2eTouch);
}
