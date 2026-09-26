import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "component",
          environment: "jsdom",
          environmentOptions: { jsdom: { url: "http://localhost/" } },
          globals: true,
          include: ["client/src/**/*.test.{ts,tsx}"],
          setupFiles: ["./client/src/test/setup.ts"],
        },
      },
      {
        test: {
          name: "unit-integration",
          environment: "node",
          globals: true,
          include: ["server/**/*.test.ts", "tests/integration/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html", "lcov"],
      reportOnFailure: true,
      include: ["shared/**/*.ts", "server/**/*.ts", "client/src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "client/src/test/**"],
      thresholds: {
        perFile: false,
        statements: 68,
        lines: 69,
        functions: 66,
        branches: 64,
        "client/src/{features/player/adaptiveQuality,features/workspace/workspaceUrls}.ts":
          {
            statements: 85,
            lines: 85,
            functions: 85,
            branches: 80,
          },
        "shared/contracts.ts": {
          statements: 95,
          lines: 95,
          functions: 95,
          branches: 90,
        },
        "server/{application/downloads/downloadOptions,application/jobs/sessionJobQueue,domain/explorerTree,infrastructure/runtime/mediaClassification,infrastructure/runtime/runtimePrimitives,media/*}.ts":
          {
            statements: 95,
            lines: 95,
            functions: 95,
            branches: 90,
          },
      },
    },
  },
});
