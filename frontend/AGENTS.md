# AGENTS.md — Frontend

本サブディレクトリは React + Vite + GrapesJS + ReactFlow によるフロントエンド。プロジェクト全般のルールは上位の [../AGENTS.md](../AGENTS.md) を参照。

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Dev server (http://localhost:5173)
npm run build      # TypeScript check + Vite build
npm run lint       # ESLint
```

## Key Directories

- `src/components/flow/` — Flow diagram editor (ReactFlow-based)
- `src/grapes/blocks.ts` — 60+ pre-built block definitions
- `src/store/` — Persistence layer (flowStore, customBlockStore)
- `src/mcp/mcpBridge.ts` — Browser-side WebSocket client

## Data Flow

- **Save:** GrapesJS autosave → remoteStorage → mcpBridge (WS) → wsBridge → active workspace の `<workspace>/<dataDir>/screens/{id}.json` (例: `workspaces/my-app/harmony/screens/{id}.json`、path は `harmony.json` の `dataDir` 設定に依存、#856 で `data/` 直書きから移行済)
- **Fallback:** If WS disconnected → localStorage (`gjs-screen-{id}`)
- **Sync:** wsBridge broadcasts changes to all connected browser tabs

workspace / dataDir 構造の詳細は [`../docs/spec/workspace.md`](../docs/spec/workspace.md) を参照。

## Environment Notes

- **HTTP access:** `crypto.randomUUID()` is unavailable in non-secure contexts. Use `generateUUID()` from `src/utils/uuid.ts` instead.
- **Playwright MCP:** Do not use `--headless=false` flag on Windows.

## Testing

- Vitest: `src/**/*.test.ts` — ストアロジック・ユーティリティ
- Playwright: `e2e/**/*.spec.ts` — UI・ナビゲーション操作

Claude Code 利用時は `/test-strategy` スキルが自動起動 (詳細は `CLAUDE.md` 参照)。

### e2e batch 中の Vite crash (#992)

multi browser context の e2e で **Vite dev server (port 5173) が間欠 crash** する問題が観測された。現在は #980-A の click 経路改善で症状抑止中。再発時の調査・回避策・再現 scaffold spec は [`../docs/spec/e2e-vite-stability.md`](../docs/spec/e2e-vite-stability.md) を参照。

## UI Conventions

詳細仕様は [../docs/spec/](../docs/spec/README.md) に集約。一覧系 UI を触る前に必ず読む:

- **一覧系 UI** (選択・キーボード・D&D・コピペ・ソート・フィルタ・Read-only モード・No 列永続フィールド): [../docs/spec/list-common.md](../docs/spec/list-common.md)
  - `DataList` / `useListSelection` / `useListKeyboard` / `useListClipboard` / `useListFilter` / `useListSort` / `<FilterBar>` / `<SortBar>` / `<ViewModeToggle>`
  - 対象画面: 画面一覧・テーブル一覧・処理フロー一覧・テーブル定義 > カラム一覧

## Themes & Custom Blocks

- Themes: standard (default Bootstrap), card, compact, dark — CSS injected into GrapesJS canvas iframe
- Custom blocks persist to active workspace の `<workspace>/<dataDir>/custom-blocks.json` via customBlockStore (例: `workspaces/my-app/harmony/custom-blocks.json`)

## Routing / Tab Policy

上位の [../AGENTS.md](../AGENTS.md) を参照 (Routing と Tab Policy は全体規約)。
