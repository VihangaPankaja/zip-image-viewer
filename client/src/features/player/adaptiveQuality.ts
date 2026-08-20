import type { HlsConfig } from "hls.js";

export const AUTO_QUALITY = "auto" as const;

export function createAdaptiveHlsConfig(): Partial<HlsConfig> {
  return {
    startLevel: -1,
    capLevelToPlayerSize: true,
    capLevelOnFPSDrop: true,
    maxBufferLength: 30,
    backBufferLength: 30,
    enableWorker: true,
  };
}

export function resolveManualLevel(
  quality: string,
  levelHeights: readonly number[],
): number {
  if (quality === AUTO_QUALITY) return -1;
  const requestedHeight = Number.parseInt(quality, 10);
  if (!Number.isFinite(requestedHeight) || levelHeights.length === 0) return -1;

  let selectedIndex = 0;
  let selectedDifference = Number.POSITIVE_INFINITY;
  for (const [index, height] of levelHeights.entries()) {
    const difference = Math.abs(height - requestedHeight);
    if (difference < selectedDifference) {
      selectedIndex = index;
      selectedDifference = difference;
    }
  }
  return selectedIndex;
}

export async function loadHlsModule(): Promise<typeof import("hls.js")> {
  return import("hls.js");
}
