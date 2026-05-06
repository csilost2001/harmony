/**
 * vite.config.worktree.ts — ワークツリー用 dev サーバー設定 (#703 R-5)
 *
 * main worktree が port 5173 を使用している場合に競合を避けるため、
 * port 5174 を使用する。playwright.config.worktree.ts と組み合わせて使う。
 *
 * Usage:
 *   npx vite --config vite.config.worktree.ts
 *   PLAYWRIGHT_PORT=5174 npx playwright test --config playwright.config.worktree.ts
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    allowedHosts: true,
  },
});
