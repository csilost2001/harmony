import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // Node 25 以上は、実験的な Web Storage の localStorage を global に持つ (--localstorage-file が無いと undefined)。
    // jsdom の localStorage がそれに隠れて、setup.ts の localStorage.clear() が全試験で落ちるため、Node 側を切る (#1571)。
    // engines は Node 26 以上なので、この旗は常に使える
    execArgv: ["--no-experimental-webstorage"],
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
