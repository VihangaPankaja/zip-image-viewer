import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "component",
          environment: "jsdom",
          environmentOptions: {
            jsdom: {
              url: "http://localhost/",
            },
          },
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
      reporter: ["text", "json", "html", "lcov"],
      reportOnFailure: true,
      include: [
        "shared/contracts.ts",
        "server/application/downloads/downloadOptions.ts",
        "server/application/jobs/sessionJobQueue.ts",
        "server/domain/explorerTree.ts",
        "server/infrastructure/runtime/mediaClassification.ts",
        "server/infrastructure/runtime/runtimePrimitives.ts",
        "server/media/*.ts",
        "client/src/features/player/adaptiveQuality.ts",
        "client/src/features/workspace/workspaceUrls.ts",
      ],
      thresholds: {
        perFile: false,
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 80,
        "shared/contracts.ts": {
          statements: 95,
          lines: 95,
          functions: 95,
          branches: 90,
        },
        "server/{application,domain,infrastructure,media}/**/*.ts": {
          statements: 95,
          lines: 95,
          functions: 95,
          branches: 90,
        },
      },
    },
  },
});
