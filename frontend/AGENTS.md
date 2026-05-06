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

- **Save:** GrapesJS autosave → remoteStorage → mcpBridge (WS) → wsBridge → `data/screens/{id}.json`
- **Fallback:** If WS disconnected → localStorage (`gjs-screen-{id}`)
- **Sync:** wsBridge broadcasts changes to all connected browser tabs

## Environment Notes

- **HTTP access:** `crypto.randomUUID()` is unavailable in non-secure contexts. Use `generateUUID()` from `src/utils/uuid.ts` instead.
- **Playwright MCP:** Do not use `--headless=false` flag on Windows.

## Testing

- Vitest: `src/**/*.test.ts` — ストアロジック・ユーティリティ
- Playwright: `e2e/**/*.spec.ts` — UI・ナビゲーション操作

Claude Code 利用時は `/test-strategy` スキルが自動起動 (詳細は `CLAUDE.md` 参照)。

## UI Conventions

詳細仕様は [../docs/spec/](../docs/spec/README.md) に集約。一覧系 UI を触る前に必ず読む:

- **一覧系 UI** (選択・キーボード・D&D・コピペ・ソート・フィルタ・Read-only モード・No 列永続フィールド): [../docs/spec/list-common.md](../docs/spec/list-common.md)
  - `DataList` / `useListSelection` / `useListKeyboard` / `useListClipboard` / `useListFilter` / `useListSort` / `<FilterBar>` / `<SortBar>` / `<ViewModeToggle>`
  - 対象画面: 画面一覧・テーブル一覧・処理フロー一覧・テーブル定義 > カラム一覧

## Themes & Custom Blocks

- Themes: standard (default Bootstrap), card, compact, dark — CSS injected into GrapesJS canvas iframe
- Custom blocks persist to `data/custom-blocks.json` via customBlockStore

## Routing / Tab Policy

上位の [../AGENTS.md](../AGENTS.md) を参照 (Routing と Tab Policy は全体規約)。
