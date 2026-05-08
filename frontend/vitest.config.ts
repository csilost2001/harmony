import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/helpers/**/*.test.ts", "e2e/__fixtures__/**/*.test.ts", "e2e/__validation__/**/*.test.ts"],
    environmentMatchGlobs: [
      // e2e helper tests run in Node.js (use fs/path/ws, no DOM)
      ["e2e/helpers/**/*.test.ts", "node"],
      ["e2e/__fixtures__/**/*.test.ts", "node"],
      ["e2e/__validation__/**/*.test.ts", "node"],
    ],
    coverage: {
      include: ["src/store/**", "src/hooks/**", "src/grapes/**", "src/utils/**"],
    },
  },
});
