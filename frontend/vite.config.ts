import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// VITE_PORT: worktree 環境で別 port を使う場合に設定 (#703 R-5 D-2)
const VITE_PORT = parseInt(process.env.VITE_PORT ?? "5173", 10);

/**
 * @measured/puck の dist/index.css は冒頭で `@import "https://rsms.me/inter/inter.css"` を呼び、
 * モバイル / プロキシ / 外部 CDN 不通環境で永久 pending → ページ load 未完了 → カーソルが
 * ロード中スピナー表示のまま (#813 hotfix、ユーザー報告)。CDN 依存は本フレームワーク本来の
 * 設計外なので transform で削除する。Inter font はデフォルト font fallback で代替させる。
 */
function stripPuckCdnImport(): Plugin {
  return {
    name: 'strip-puck-cdn-import',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('@measured/puck') && id.endsWith('.css')) {
        return code.replace(/@import\s+["']https:\/\/rsms\.me\/inter\/inter\.css["']\s*;?\s*/g, '');
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [stripPuckCdnImport(), react()],
  server: {
    port: VITE_PORT,
    strictPort: VITE_PORT === 5173, // 標準 port のみ strictPort (worktree は別 port で起動)
    host: true,
    allowedHosts: true,
  },
})
