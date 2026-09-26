import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/review",
  testMatch: "screenshots.spec.ts",
  outputDir: "test-results/review-run",
  workers: 1,
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
    command:
      "node node_modules/vite/bin/vite.js --configLoader runner --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
  },
});
