import { expect, type Page } from "@playwright/test";

export async function setCssViewport(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  const viewport = await page.evaluate(() => {
    if (!visualViewport) throw new Error("Visual viewport is unavailable.");
    return {
      width: innerWidth,
      height: innerHeight,
      visualWidth: visualViewport.width,
      visualHeight: visualViewport.height,
    };
  });
  // Windows WebKit applies desktop display scaling to the emulated viewport.
  if (viewport.width !== width || viewport.height !== height) {
    await page.setViewportSize({
      width: Math.ceil((width * width) / viewport.visualWidth - 0.00001),
      height: Math.ceil((height * height) / viewport.visualHeight - 0.00001),
    });
  }
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({
    width,
    height,
  });
}
