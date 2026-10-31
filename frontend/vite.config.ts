import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// VITE_PORT: worktree 環境で別 port を使う場合に設定 (#703 R-5 D-2)
const VITE_PORT = parseInt(process.env.VITE_PORT ?? "5173", 10);

/**
 * 画面の版の識別子 (#1572)。`vite build` のたびに 1 つ作り、バンドルに `__HARMONY_BUILD_ID__` として埋め込み、
 * `build-id.txt` にも書く。backend は dist の build-id.txt を読んで、接続してきた画面に自分の版を知らせる。
 * dev (serve) では何もしない (画面の ID は null で、版の比較をしない)。
 */
function buildIdPlugin(): Plugin {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: 'harmony-build-id',
    apply: 'build',
    config: () => ({ define: { __HARMONY_BUILD_ID__: JSON.stringify(id) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-id.txt', source: `${id}\n` })
    },
  }
}

export default defineConfig({
  plugins: [react(), buildIdPlugin()],
  server: {
    port: VITE_PORT,
    strictPort: VITE_PORT === 5173, // 標準 port のみ strictPort (worktree は別 port で起動)
    host: true,
    allowedHosts: true,
  },
})
