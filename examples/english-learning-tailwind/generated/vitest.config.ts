/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * vitest 設定 — Step P3 (Screen component test) 用
 *
 * 使用方法:
 *   npm run test:p3
 *   npx vitest run src/test/p3/
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/test/**/*.test.tsx', 'src/test/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    alias: {
      // Next.js src ディレクトリ (generated/src/) への alias
      '@': path.resolve(__dirname, './src'),
    },
  },
});
