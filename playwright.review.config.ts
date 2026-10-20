import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/review",
  testMatch: "screenshots.spec.ts",
  outputDir: "test-results/review-run",
  workers: 2,
  globalSetup: "./tests/review/gallerySetup.ts",
  globalTeardown: "./tests/review/galleryTeardown.ts",
  // Each device runs sequentially with its own fixture servers and manifest fragment.
  projects: ["Mobile", "Tablet", "Desktop", "Ultrawide"].map((name) => ({
    name,
    grep: new RegExp(`\\b${name} (?:light|dark) `),
  })),
  retries: 0,
  timeout: 120_000,
  use: {
    browserName: "chromium",
    baseURL: "http://127.0.0.1:5174",
    locale: "en-GB",
    timezoneId: "UTC",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
  },
  webServer: {
    command: "vp dev --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
  },
});
