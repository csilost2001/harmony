# AGENTS.md

本リポジトリを扱う AI コーディングエージェント (Claude Code / Codex CLI 等) 共通のガイダンス。
Claude Code 固有の補足は `CLAUDE.md`、Codex 固有の設定は `.codex/config.toml` を参照。

詳細な規約は以下に分けて置いている。本ファイルは「毎回必要な要点」だけを書く。

| 内容 | 参照先 |
|---|---|
| ISSUE 起票・PR 作成・レビュー・シリーズ PR の詳細 | [docs/conventions/issue-and-pr-policy.md](docs/conventions/issue-and-pr-policy.md) |
| docs-site (HTML 仕様書) と AI ブラウザ確認 | [docs/conventions/docs-site-and-browser-smoke.md](docs/conventions/docs-site-and-browser-smoke.md) |
| 完了判定 (回帰テストの trace 照合) | [docs/conventions/completion-gate.md](docs/conventions/completion-gate.md) |
| 進行中の再設計計画と設計者判断 | [docs/plans/redesign-2026-10.md](docs/plans/redesign-2026-10.md) |

## Project Overview

**Harnize Harmony** (社内呼称: Harmony) — 日本の Web システム開発の設計書 (画面 / 処理フロー / テーブル / 規約 等) を Web 上で WYSIWYG に編集・閲覧するツール。設計書の原本は AI が読みやすい JSON / Markdown で保持し、プログラムはその時点の AI が設計書から推論して生成する。

- **frontend/** — React + Vite + GrapesJS / Puck + ReactFlow による設計 UI
- **backend/** — MCP server + WebSocket bridge + ファイル永続化 + lock / draft 管理 (port 5179)
- **shared/** — frontend / backend 共通の型・定数 (`@harmony/shared`)
- **schemas/v3/** — 設計書の JSON Schema (一次成果物)

## 必ず守ること

1. **schema は設計者の専権** (#511)。`schemas/v3/*.json` を AI 判断で変更しない。業務記述で表せない場合は拡張機構 (`extensions/<namespace>/*.json`) → 既存フィールドでの代替 → ISSUE 起票して停止、の順。テストを通すための schema 拡張は禁止。詳細: [docs/spec/schema-governance.md](docs/spec/schema-governance.md)
2. **発見した課題は放置しない**。本 PR で対応するのが原則。別 ISSUE 化は「別機能 / 再設計 / 大規模 / 別チーム」のいずれかに明確に該当する場合だけ。フォローアップのさらにフォローアップは user 承認なしに起票しない。「記録だけして後で」は禁止。詳細: [issue-and-pr-policy.md](docs/conventions/issue-and-pr-policy.md)
3. **`main` に直接コミットしない**。`origin/main` からブランチを切る (`feat/issue-<N>-<slug>` / `feat/<topic>` / `fix/<slug>` / `docs/<slug>`)。PR は squash merge、タイトルに ISSUE 番号。複数 ISSUE を閉じるときは 1 行ずつ `Closes #N`。
4. **画面やデータを開いただけで原本を書き換えない** (明示保存モデル)。保存は利用者の操作か AI の明示的な変更だけ。
5. **ユーザー向けテキストはすべて日本語** (UI 文言 / 進捗報告 / commit / PR / ISSUE)。コマンド・URL・エラー原文・固有名詞は原文のまま。

## Commands

```bash
npm install            # repo root で 1 回 (npm workspaces。subdir で install しない)
npm run backend        # ターミナル A: backend (port 5179、常駐)
npm run frontend       # ターミナル B: frontend (port 5173)
npm run check          # コミット前の一括検証 (型検査 / 直書き色検査 / 単体テスト)
npm run kill           # 5173 / 5179 を握るプロセスを停止
```

| 用途 | コマンド |
|---|---|
| frontend 単体テスト | `npm run test:unit` |
| backend 単体テスト | `npm run test:backend` |
| E2E (Playwright がサーバも起動) | `cd frontend && npx playwright test <spec>` |
| 回帰 E2E の trace 照合 (merge 前に必須) | `node scripts/verify/regression-trace-check.mjs --auto-run` |
| サンプル JSON の runtime 契約検証 | `cd frontend && npm run validate:samples -- ../examples/<project-id>` |
| 全画面スクリーンショット | `npm run ui:shots -- --out .tmp/screenshots/<名前> [--theme dark]` |
| 配色監査 (コントラスト / テーマ不一致) | `npm run ui:audit` |

- E2E は自前で起動した backend を再利用すると E2E 用環境変数が効かず失敗する。E2E 実行前は `npm run kill` して Playwright にサーバを起動させる。
- AI が検証のために dev server を起動した場合は、作業の終わりに必ず `npm run kill` で止める。

## 配置ルール

| 種別 | 置き場所 |
|---|---|
| スクリーンショット | `.tmp/screenshots/` |
| AI の中間ファイル・レビュー出力 | `.tmp/` (レビューは `.tmp/review-cache/`) |
| ログ | `logs/` |
| ドッグフード用ワークスペース | `workspaces/dogfood-<目的-YYYYMMDD>/` (`data/` は本体専用、使わない) |
| worktree (並行作業が必要な場合のみ) | `.tmp/worktrees/<name>/` |

プロジェクトルート直下に一時ファイルを置かない。

## Architecture

```
AI Agent ──(http://localhost:5179/mcp)──┐
                                        ▼
                                   backend ←──(ws://0.0.0.0:5179)──→ Browser
                                        ▼
                          data/extensions/ (本体、git tracked)
                          workspaces/<id>/ (利用者プロジェクト、gitignored)
```

- active workspace の `harmony.json` の `dataDir` 配下に `screens/` `process-flows/` `tables/` 等の JSON を保存する
- 編集中の作業コピーはサーバ側 `data/.drafts/<wsId>/` に置き、ロックで排他する: [docs/spec/edit-session-draft.md](docs/spec/edit-session-draft.md)
- 設計途中でも保存でき、schema 違反は UI で警告表示する (draft-state): [docs/spec/draft-state-policy.md](docs/spec/draft-state-policy.md)
- ワークスペース: [docs/spec/workspace.md](docs/spec/workspace.md) / 同時並行編集: [docs/spec/workspace-multi.md](docs/spec/workspace-multi.md)

### Routing (実 URL は `/w/:wsId/<path>`。`/workspace/*` と `/ai-settings` のみ top-level)

| Path | 画面 |
|---|---|
| `/` | ダッシュボード |
| `/screen/flow` `/screen/list` | 画面フロー / 画面一覧 |
| `/screen/design/:screenId` `/screen/items/:screenId` | 画面デザイナ / 画面項目 |
| `/table/list` `/table/edit/:tableId` `/table/er` | テーブル一覧 / 編集 / ER 図 |
| `/process-flow/list` `/process-flow/edit/:processFlowId` | 処理フロー一覧 / 編集 |
| `/sequence/*` `/view/*` `/view-definition/*` | シーケンス / DB ビュー / ビュー定義 |
| `/page-layout/list` `/page-layout/edit/:id` `/gadget/list` | ページレイアウト / ガジェット |
| `/generic-definition[/:kind[/:name]]` | 汎用定義 (メッセージ・ドメイン型 等 17 種) |
| `/conventions/catalog` `/extensions` `/project/tech-stack` | 規約 / 拡張 / 技術スタック |

URL は `/category/feature[/:id]`。HeaderMenu から到達する画面と個別リソース編集画面はすべてタブで開く (一覧は singleton、編集はリソースごと)。実装: `frontend/src/components/AppShell.tsx` の `<Routes>`。

### Key Directories

- `frontend/src/styles/tokens.css` — アプリ UI の唯一の色定義 (ライト / ダーク)。画面の CSS に色を直書きしない (`npm run verify:colors` で検査)
- `frontend/src/components/` — 各画面。一覧系 UI は [docs/spec/list-common.md](docs/spec/list-common.md) を先に読む
- `frontend/src/editor/` — 画面エディタの backend 境界 (GrapesJS / Puck)
- `frontend/src/mcp/mcpBridge.ts` / `backend/src/wsBridge.ts` — ブラウザ ⇄ backend の WebSocket
- `backend/src/tools.ts` — MCP tool 定義
- `shared/src/` — 共通型・定数。変更後は consumer の build が shared を先に build する

## 処理フロー (ProcessFlow) — 一次成果物は JSON Schema

変更順序: 仕様書 [`docs/spec/process-flow-*.md`](docs/spec/README.md) → schema → TypeScript 型 (`frontend/src/types/`) → UI。サンプルは `examples/<project-id>/` に業務アプリ単位で置く。業務設計者向けの使い方: [docs/user-guide/](docs/user-guide/README.md)

## テスト

- Vitest: `frontend/src/**/*.test.ts(x)` / `backend/src/**/*.test.ts`
- Playwright: `frontend/e2e/**/*.spec.ts` (MCP 連携は `e2e/mcp/`)
- 既存テストを仕様変更なしに書き換えない。UI 文言・構造の意図的な変更に伴うセレクタ追従は可 (commit に明記)
- e2e の失敗は isolation 再実行で flake か実バグかを切り分ける。strict-mode 違反は flake ではない

## 完了の定義

- `npm run check` が通る / 関連 E2E が通る / UI 変更は `npm run ui:audit` で両テーマ 0 件
- 大規模変更・spec 絡みは別セッションで独立レビューを行い、Must-fix を解消してから merge
- 機能は「設計者が UI で実際に使える」まで到達して完了 (schema / validator だけでは未完了)
