# AGENTS.md

本リポジトリを扱う AI コーディングエージェント (Claude Code / Codex CLI 等) 共通のガイダンス。
Claude Code 固有の補足は `CLAUDE.md`、Codex 固有の設定は `.codex/config.toml` を参照。

詳細な規約は以下に分けて置いている。本ファイルは「毎回必要な要点」だけを書く。

| 内容 | 参照先 |
|---|---|
| ISSUE 起票・PR 作成・レビュー・シリーズ PR の詳細 | [docs/conventions/issue-and-pr-policy.md](docs/conventions/issue-and-pr-policy.md) |
| docs-site (HTML 仕様書) と AI ブラウザ確認 | [docs/conventions/docs-site-and-browser-smoke.md](docs/conventions/docs-site-and-browser-smoke.md) |
| 品質・性能の検査と道具 (ビルドサイズ予算 / 型の食い違い / カバレッジ / E2E 報告 / 使い回し) | [docs/conventions/quality-and-performance-tooling.md](docs/conventions/quality-and-performance-tooling.md) |
| 設計の分析 (影響分析・対応表・未使用・用語・命名規約・SLA / ジョブ・外部契約・進捗・テスト雛形 / データ・OpenAPI) と、点検の設定 (抑制・独自ルール) | [design-analysis.md](docs/spec/design-analysis.md) / [design-check.md](docs/spec/design-check.md) |
| 操作性 (通知の履歴・表示の設定・お気に入り・コマンドパレット・変更履歴・一括変更・別画面へのコピー・スニペット・設計全体の検索置換・表で編集・ドラッグのキーボード代替・ツアーとヘルプ・並べて表示・エラー復旧) | [ux-operations.md](docs/spec/ux-operations.md) |
| 連携と運用 (Word / Excel 書き出し・設計書の体裁と改訂履歴・図の書き出し・Git・レビューコメント・承認・利用者と権限・変更の記録・通知・取り込み・生成の管理・技術スタックのプリセット・版とリリースノート・資料の鮮度検査) | [integration-ops.md](docs/spec/integration-ops.md) |
| マーカー (AI への指示・質問。どの設計にも付けられる・`/markers` の一覧と集計・AI に渡す文・Ctrl+Alt+M・`authoring.markers` を画面と MCP が共通に読み書き) | [ui-markers.md](docs/spec/ui-markers.md) |
| キーボード・移動 (画面内の検索 Ctrl+F・参照元 Shift+F12・表の Ctrl+D と行の挿入・複製・削除・コマンドパレットの画面の操作・F6 で領域・部品の追加 /・ダイアログの Esc とフォーカス) | [ui-keyboard.md](docs/spec/ui-keyboard.md) |
| ドラッグ・直接操作・一括 (画面デザイナの文言のその場編集・右クリック・複数選択・段の幅・属性コピー / 一覧の列の設定・条件で選ぶ・表としてコピー・行の並べ替え・オートフィル / 図の拡大縮小・ER のカラムから線・画面フローの線 / タブを右へドラッグ・ファイルのドロップで取り込み・参照の一括付け替え) | [ui-direct-manipulation.md](docs/spec/ui-direct-manipulation.md) |
| 入力の信頼性・見通し (欄の直下の指摘と直し方・式の書き間違い・近い名前・保存の状態・変更した欄・元に戻した内容の通知・取り消せる削除・F8 次の要確認・処理フローの目次・直接のリンク・入力専用モード・全角の正規化・操作数の予算) | [ui-input-reliability.md](docs/spec/ui-input-reliability.md) |
| 一覧・探索・見通し (閉じたタブを開き直す Ctrl+Alt+T・画面の履歴 Ctrl+Alt+←→・パンくず・保存した絞り込み・グループ表示・Space ですぐ見る・まとめての操作・最近開いた順・行の印・CSV / Excel 保存・近い名前・使っているもの・Ctrl+K の `t:` 接頭辞・今日やること) | [ui-lists-navigation.md](docs/spec/ui-lists-navigation.md) |
| 図・可視化 (図の道具: 検索 Ctrl+F・つながりの強調・関連 N 段・整列とガイド・ER のカラム表示・線の形・凡例・PNG / Mermaid / 印刷・基準との差分・表示位置の記憶・`[` `]` でつながりをたどる / つながり図 / 処理フローの流れ図とシーケンス図 / 画面フローの自動配置) | [ui-diagrams.md](docs/spec/ui-diagrams.md) |
| 編集体験の深掘り (画面デザイナのサンプル値・状態・寸法・部品検索 / 処理フローの畳み・変数・囲む・判定表・式の試し実行・机上演習 / テーブルの型変更の影響・サンプル INSERT・インデックス提案 / 画面項目の食い違い / スクロール復元・Ctrl+Alt+Backspace で最後の編集へ・クリップボード履歴・用語ゆれ) | [ui-editing-depth.md](docs/spec/ui-editing-depth.md) |
| 履歴・比較・共有・書き出し (ヘッダーの「設計のあゆみ」: 変更の記録と最終編集者・版を比べる・コミット文 / レビュー依頼文・完了の確認・個人メモ・この設計だけの書き出し・ファイルの場所のコピー・試作 / レビューの宛先 @名前・進み具合 / 印刷用スタイル・スナップショット HTML の検索・書き出しの設定 / 取り込みの差・通知の受け取り方・期間のまとめ) | [ui-history-sharing.md](docs/spec/ui-history-sharing.md) |
| アクセシビリティ・設定・学習・性能 (スキップリンク・フォーカスリング (outline: none を増やさない検査)・高コントラスト / 強制カラー・動きを減らす設定・表の読み上げ・ショートカットの割り当て・ヘルプの検索・設定の書き出し / 読み込み・通しの案内・長い一覧の窓表示・進み具合) | [ui-a11y-settings-perf.md](docs/spec/ui-a11y-settings-perf.md) |
| 初めての人が迷いやすいところの改善 (一覧のダブルクリックの案内・閲覧中の案内・「編集を終える」・追加ボタンの名前を「〜を追加」に・未配置のタブ・新しい処理フローはラフから・デザインと項目定義を行き来しても確認が出ない: 衝突の判定と「前回の編集の続き」の条件) | [ui-first-run-ux.md](docs/spec/ui-first-run-ux.md) |
| 処理フローの「流れ」表示 (AI が作った複雑な処理を人が読むための画面: 入れ子・ガード・言葉の条件・概要 / 詳細 / 実装・見出し・出口の一覧・変数の流れ・確認済み ✓。schema の任意項目 `heading` / `label` / `collectionItemLabel`) | [process-flow-story-view.md](docs/spec/process-flow-story-view.md) |
| 入力補助 (参照の補完・SQL の表名とカラム名・定義へ移動 F12・検索できる選択・カラムの物理名と型の提案・外部キーの候補・テーブルから画面項目・ID の候補・工程のおすすめ・日本語入力の Enter) | [ui-input-assist.md](docs/spec/ui-input-assist.md) |
| 完了判定 (回帰テストの trace 照合) | [docs/conventions/completion-gate.md](docs/conventions/completion-gate.md) |
| 進行中の再設計計画と設計者判断 | [docs/plans/redesign-2026-10.md](docs/plans/redesign-2026-10.md) |
| サーバの守り (接続トークン・要求の上限・MCP の権限)・保存前の版・外部更新の検知・ファイルの健全性 | [server-security.md](docs/spec/server-security.md) / [file-backup.md](docs/spec/file-backup.md) / [external-change-detection.md](docs/spec/external-change-detection.md) / [workspace-health.md](docs/spec/workspace-health.md) |

## Project Overview

**Harnize Harmony** (社内呼称: Harmony) — 日本の Web システム開発の設計書 (画面 / 処理フロー / テーブル / 規約 等) を Web 上で WYSIWYG に編集・閲覧するツール。設計書の原本は AI が読みやすい JSON / Markdown で保持し、プログラムはその時点の AI が設計書から推論して生成する。

- **frontend/** — React + Vite + ReactFlow による設計 UI (画面デザインは業務部品デザイナ。旧エディタ GrapesJS / Puck は廃止)
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
| 全画面スクリーンショット (dev server が未起動なら自動で起動・終了時に停止) | `npm run ui:shots -- --out .tmp/screenshots/<名前> [--theme dark]` |
| 配色監査 (コントラスト / テーマ不一致。同上。指摘があれば終了コード 1) | `npm run ui:audit` |
| 狭い画面 (タブレット幅 1024 / 768px) で崩れる画面の検出 (同上。指摘があれば終了コード 1) | `npm run ui:narrow [-- --width 1024,768]` |
| 設計の要確認事項の検査 (終了コードで判定。`npm run check` に含まれる) | `npm run check:design -- examples/<project-id> [--strict] [--info]` |
| テスト観点表の書き出し (画面入力の境界値・処理の分岐。ID つき。テストコード生成の入力) | `npm run export:tests -- examples/<project-id> --format json` |
| 設計書 HTML の書き出し | `npm run export:doc -- examples/<project-id> --out .tmp/doc.html` |
| 大きなプロジェクトでの性能 (画面 約 300 / 処理フロー 約 150 / テーブル 約 170。回帰には含めない) | `cd frontend && npx playwright test e2e/perf-large-project.spec.ts` (大きなワークスペースは `scripts/dev/make-large-workspace.mjs` が作る) |
| 差分の行のカバレッジ (PR 本文に載せる) / E2E の遅い試験・flake の一覧 | `npm run coverage:changed` / `npm run e2e:report` ([quality-and-performance-tooling.md](docs/conventions/quality-and-performance-tooling.md)) |
| backend の重い読み出しの時間 (規模を増やしたときの確認) | `npx tsx scripts/dev/bench-backend.mts <workspace-dir>` (同上) |
| 初回セットアップ (診断して、足りないものをそろえる。`-- --check` は診断だけ、`-- --sample retail` でサンプルを複製) | `npm run setup` |
| 資料の鮮度検査 (相対リンク・`npm run` の名前・Routing の表と画面の経路・UI 操作リファレンス・スキル表。`npm run check` に含まれる) / スクリーンショットの撮り直し / リリースノート (git の履歴から `docs/release-notes.md`) | `npm run check:docs [-- --info]` / `npm run docs:shots [-- --all]` / `npm run release:notes` |
| スキーマの版の移行 (予行が既定。`--apply` で書く。登録された移行はいまは空) | `npm run migrate:schema -- <workspace-dir> [--apply]` ([schema-migration.md](docs/spec/schema-migration.md)) |
| AI (MCP) から: 設計の点検・参照元・改名・テスト観点 | `designer__check_design` (設計を直したら、完了報告の前に呼び error / warning 0 件にする。要確認は、画面か design-check.json で人が理由つきで抑制するもので、AI は黙らせない) / `designer__analyze_design` (影響分析・対応表・未使用・用語ほか。読み取りのみ) / `designer__find_references` (誰が参照しているか) / `designer__rename_entity` (既定は予行、`apply: true` で実行) と `designer__undo_rename` / `designer__replace_references` (参照元を選んで別の設計へ付け替え。既定は予行) と `designer__undo_replace_references` / `designer__get_test_viewpoints` / コード生成のあとは `designer__record_generation` (どの設計からどのファイルを作ったか) → 再生成の前は `designer__check_generation_drift` と `designer__get_regeneration_diff` / レビューの指摘は `designer__add_review_findings` (位置つきのコメント) と `designer__list_review_comments` |

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
- 上書きされる前の設計ファイルは `<ワークスペース>/.harmony-backups/` に世代で残る (`.harmony-journal/` は複数ファイル操作の復旧用)。どちらも自分の `.gitignore` を持つ。backend の外での書き換えはファイル監視で検知して画面へ知らせる
- 設計途中でも保存でき、schema 違反は UI で警告表示する (draft-state): [docs/spec/draft-state-policy.md](docs/spec/draft-state-policy.md)
- ワークスペース: [docs/spec/workspace.md](docs/spec/workspace.md) / 同時並行編集: [docs/spec/workspace-multi.md](docs/spec/workspace-multi.md)

### Routing (実 URL は `/w/:wsId/<path>`。`/workspace/*` と `/ai-settings` のみ top-level)

| Path | 画面 |
|---|---|
| `/` | ダッシュボード (「設計の要確認」パネルあり)。どの画面でも `Ctrl+K` で画面・テーブル・処理フロー等へ飛べる ([quick-open.md](docs/spec/quick-open.md)) |
| `/document` | 設計書 (読み取り専用の紙面。HTML / Word / Excel 保存・印刷。体裁と改訂履歴の設定) |
| `/markers` | マーカー一覧 (全設計の AI への指示・質問。絞り込み・まとめて解決・AI に渡す文のコピー) |
| `/analysis` | 設計の分析 (要確認・影響分析・対応表・整理・運用・進捗・ルール・書き出し) |
| `/operations` | 連携と運用 (レビューと承認・変更の記録・Git・通知・生成の管理・取り込み・利用者と権限・版と更新) |
| `/screen/flow` `/screen/list` | 画面フロー / 画面一覧 |
| `/screen/design/:screenId` `/screen/items/:screenId` | 画面デザイナ / 画面項目 |
| `/table/list` `/table/edit/:tableId` `/table/er` | テーブル一覧 / 編集 / ER 図 |
| `/process-flow/list` `/process-flow/edit/:processFlowId` | 処理フロー一覧 / 編集 |
| `/sequence/*` `/view/*` `/view-definition/*` | シーケンス / DB ビュー / ビュー定義 |
| `/business-flow/list` `/business-flow/edit/:id` | 業務フロー (スイムレーン) 一覧 / 編集 |
| `/report/list` `/report/edit/:id` | 帳票 一覧 / 編集 |
| `/page-layout/list` `/page-layout/edit/:id` `/gadget/list` | ページレイアウト / ガジェット |
| `/generic-definition[/:kind[/:name]]` | 汎用定義 (メッセージ・ドメイン型 等 17 種) |
| `/conventions/catalog` `/extensions` `/project/tech-stack` | 規約 / 拡張 / 技術スタック |
| `/workspace/*` | ワークスペースの一覧・選択 (top-level) |
| `/ai-settings` | AI 設定 (top-level) |

URL は `/category/feature[/:id]`。HeaderMenu から到達する画面と個別リソース編集画面はすべてタブで開く (一覧は singleton、編集はリソースごと)。実装: `frontend/src/components/AppShell.tsx` の `<Routes>`。

### Key Directories

- `frontend/src/styles/tokens.css` — アプリ UI の唯一の色定義 (ライト / ダーク)。画面の CSS に色を直書きしない (`npm run verify:colors` で検査)
- `frontend/src/components/` — 各画面。一覧系 UI は [docs/spec/list-common.md](docs/spec/list-common.md) を先に読む
- `frontend/src/components/screen-layout/` — 業務部品デザイナ (画面デザイン・プロジェクト独自部品の登録 / 編集)。仕様: [docs/spec/screen-layout.md](docs/spec/screen-layout.md) / [docs/spec/layout-components.md](docs/spec/layout-components.md)
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
