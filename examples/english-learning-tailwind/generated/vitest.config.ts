/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * vitest 設定 — Step P3 (Screen component test) 用
 *
 * 使用方法:
 *   npm run test:p3
 *   npx vitest run src/test/p3/
 *
 * 注意: コンポーネントの実際の import パス (COMPONENT_PATH) は
 *   PLACEHOLDER のため、実装後に各テストファイルを更新すること。
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/test/**/*.test.tsx', 'src/test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // PLACEHOLDER: Next.js プロジェクトの src ディレクトリへのパスを設定すること
      '@': path.resolve(__dirname, '../src'),
    },
  },
});
