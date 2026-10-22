import type { Page } from "@playwright/test";

export async function measureThemeContrast(page: Page, includeBorders = true) {
  return page.evaluate((checkBorders) => {
    const probe = document.createElement("span");
    probe.style.transition = "none";
    document.body.append(probe);
    const luminance = (token: string) => {
      probe.style.color = `var(${token})`;
      const channels = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? [])
        .slice(0, 3)
        .map(Number);
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrast = (a: string, b: string) => {
      const x = luminance(a);
      const y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const backgrounds = [
      "--bg",
      "--bg-inset",
      "--bg-panel",
      "--bg-panel-strong",
      "--surface-highlight",
    ];
    const result = backgrounds.flatMap((background) =>
      [
        "--text",
        "--text-muted",
        "--text-dim",
        "--accent",
        "--accent-strong",
        "--accent-danger",
        "--accent-success",
      ].map((text) => ({
        pair: `${text}/${background}`,
        ratio: contrast(text, background),
        minimum: 4.5,
      })),
    );
    for (const background of backgrounds)
      result.push({
        pair: `focus/${background}`,
        ratio: contrast("--focus", background),
        minimum: 3,
      });
    for (const background of checkBorders ? backgrounds.slice(0, 4) : [])
      result.push({
        pair: `border/${background}`,
        ratio: contrast("--border", background),
        minimum: 3,
      });
    result.push({
      pair: "button label",
      ratio: contrast("--accent-contrast", "--accent"),
      minimum: 4.5,
    });
    result.push({
      pair: "hover button label",
      ratio: contrast("--accent-contrast", "--accent-strong"),
      minimum: 4.5,
    });
    probe.remove();
    return result;
  }, includeBorders);
}
