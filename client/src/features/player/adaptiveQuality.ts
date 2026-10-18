import type { HlsConfig } from "hls.js";

export const AUTO_QUALITY = "auto" as const;

export function createAdaptiveHlsConfig(
  playlistLoadPolicy?: HlsConfig["playlistLoadPolicy"],
): Partial<HlsConfig> {
  const errorRetry = playlistLoadPolicy?.default.errorRetry;
  return {
    startLevel: -1,
    capLevelToPlayerSize: true,
    capLevelOnFPSDrop: true,
    maxBufferLength: 30,
    backBufferLength: 30,
    enableWorker: true,
    xhrSetup: (xhr) => xhr.setRequestHeader("X-HLS-Preparation-Retry", "1"),
    ...(playlistLoadPolicy && {
      playlistLoadPolicy: {
        default: {
          ...playlistLoadPolicy.default,
          errorRetry: errorRetry
            ? {
                ...errorRetry,
                // Staged hardware output can take longer than the normal retry budget.
                shouldRetry: (config, count, _timeout, response, retry) => {
                  if (!config) return false;
                  const preparing = response?.code === 425;
                  // HLS.js also checks this cap after calling shouldRetry.
                  config.maxNumRetry = preparing
                    ? Math.max(errorRetry.maxNumRetry, count + 1)
                    : errorRetry.maxNumRetry;
                  return preparing || (count < errorRetry.maxNumRetry && retry);
                },
              }
            : null,
        },
      },
    }),
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
