import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["client/src/**/*.test.{ts,tsx}"],
    setupFiles: ["./client/src/test/setup.ts"],
  },
});
