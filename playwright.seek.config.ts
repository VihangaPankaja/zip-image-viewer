import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "tests/benchmarks",
  testMatch: "prioritySeek.spec.ts",
  workers: 1,
  outputDir: "test-results/priority-seek-run",
  projects: base.projects?.filter(({ name }) => name === "chromium"),
});
