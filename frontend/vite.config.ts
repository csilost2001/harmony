import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// VITE_PORT: worktree 環境で別 port を使う場合に設定 (#703 R-5 D-2)
const VITE_PORT = parseInt(process.env.VITE_PORT ?? "5173", 10);

export default defineConfig({
  plugins: [react()],
  server: {
    port: VITE_PORT,
    strictPort: VITE_PORT === 5173, // 標準 port のみ strictPort (worktree は別 port で起動)
    host: true,
    allowedHosts: true,
  },
})
