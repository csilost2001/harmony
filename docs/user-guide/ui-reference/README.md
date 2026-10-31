# UI 操作リファレンス

Harmony の各 UI 画面の操作マニュアル。**エンドユーザー (業務設計者・実装者) 向け**で、目的・到達経路・主要操作・データ前提・screenshot を画面単位でまとめる。

## このディレクトリの位置付け

- **canonical**: 本 README (index) + `<screen-key>.md` (各画面 1 ファイル)
- **screenshot**: `docs/ui-screenshots/ui-reference/<screen-key>/*.png`
- **build artifact**: `docs/html/user-guide/ui-reference/` (docs-site rebuild で生成、手編集禁止)
- **生成 / 更新スキル**: `/document-ui` (`ai-skills/document-ui/SKILL.md`)

仕様書 (`docs/spec/`) は設計者・実装者向けで、本ディレクトリは **画面の使い方** にフォーカス。両者で重複する内容 (例: ProcessFlow の variable lifecycle) は spec を canonical とし、本書からはリンクのみ張る。

## 記述が実際の画面と合っているか (確認状況)

各ページの先頭に「**実画面で確認した日**」が書いてあるものは、その日に実際の画面で操作して確かめた内容を含む。確認した範囲もそこに書いてある。**書いていないページは、確認していない** (続編の前の記述のまま。たとえば、一覧は「クリックで開く」ではなく「ダブルクリックで開く」だった)。画面と食い違いを見つけたら、直して、日付を付ける。

- 2026-10-17 に確認したページ: [`workspace-list`](./workspace-list.md) / [`dashboard`](./dashboard.md) / [`table-list`](./table-list.md) / [`table-editor`](./table-editor.md) / [`screen-list`](./screen-list.md) / [`screen-designer`](./screen-designer.md) / [`screen-items`](./screen-items.md) / [`process-flow-list`](./process-flow-list.md) / [`process-flow-editor`](./process-flow-editor.md) / [`common-operations`](./common-operations.md) の早見表
- 2026-10-31 に確認したページ: [`tech-stack`](./tech-stack.md) (バックエンドの言語・フレームワーク・ORM の選び方、組合せの制約、保存と読み直し。ほかのカテゴリの細かい選び方・ダークテーマは未確認)
- 確認の方法: 空のフォルダから、備品の貸出管理 (テーブル 2・画面 1・画面項目 10・処理フロー 1) を Playwright で通して作り、各操作の結果と画面を見た

## 共通の操作

- [`common-operations`](./common-operations.md) — **迷いやすい操作の早見 (ダブルクリックで開く・編集開始・ID の入力など)**、開く・探す (`Ctrl+K`)、編集開始 → 保存、タブの「●」、ID の入力、共同編集、並べ替え

## 画面一覧 (全 34 画面)

ルーティングは AGENTS.md の "Routing" 表 が canonical。

### A. ダッシュボード・全体俯瞰

プロジェクト全体の状態を俯瞰する画面群。最初に開く / 全体把握用。

- [`dashboard`](./dashboard.md) — Dashboard (`/`): プロジェクト全体俯瞰
- [`screen-flow`](./screen-flow.md) — 画面フロー図 (`/screen/flow`): ReactFlow キャンバスで画面遷移を表示
- [`er-diagram`](./er-diagram.md) — ER 図 (`/table/er`): テーブル関連を Mermaid で可視化
- [`document`](./document.md) — 設計書ビュー (`/document`): 紙面で読む・HTML / Word / Excel 保存・印刷・体裁と改訂履歴
- [`analysis`](./analysis.md) — 設計の分析 (`/analysis`): 要確認・影響分析・対応表・整理・運用・進捗・ルール・書き出し (図を含む)
- [`operations`](./operations.md) — 連携と運用 (`/operations`): レビューと承認・変更の記録・Git・通知・生成の管理・取り込み・利用者と権限・版と更新
- [`generic-definition-catalog`](./generic-definition-catalog.md) — 汎用定義カタログ (`/generic-definition`)
- [`conventions-catalog`](./conventions-catalog.md) — 横断規約カタログ (`/conventions/catalog`)

### B. リソース一覧

各リソース種別の一覧画面。共通仕様は [`docs/spec/list-common.md`](../../spec/list-common.md) 参照。

- [`screen-list`](./screen-list.md) — 画面一覧 (`/screen/list`)
- [`table-list`](./table-list.md) — テーブル一覧 (`/table/list`)
- [`process-flow-list`](./process-flow-list.md) — 処理フロー一覧 (`/process-flow/list`)
- [`sequence-list`](./sequence-list.md) — シーケンス一覧 (`/sequence/list`)
- [`view-list`](./view-list.md) — DB ビュー一覧 (`/view/list`)
- [`view-definition-list`](./view-definition-list.md) — ViewDefinition 一覧 (`/view-definition/list`)
- [`page-layout-list`](./page-layout-list.md) — ページレイアウト一覧 (`/page-layout/list`)
- [`gadget-list`](./gadget-list.md) — ガジェット一覧 (`/gadget/list`)
- [`business-flow`](./business-flow.md) — 業務フロー一覧・編集 (`/business-flow/list`, `/business-flow/edit/:id`): スイムレーン図
- [`report`](./report.md) — 帳票一覧・編集 (`/report/list`, `/report/edit/:id`): 部と項目で設計

### C. リソース個別エディタ

各リソースを編集する画面。リソース ID 単位でタブが開く (per-resource)。

- [`screen-designer`](./screen-designer.md) — 画面デザイナー (業務部品デザイナ) (`/screen/design/:id`)
- [`screen-items`](./screen-items.md) — 画面項目編集 (`/screen/items/:id`)
- [`table-editor`](./table-editor.md) — テーブル定義編集 (`/table/edit/:id`)
- [`process-flow-editor`](./process-flow-editor.md) — 処理フロー編集 (`/process-flow/edit/:id`)
- [`sequence-editor`](./sequence-editor.md) — シーケンス編集 (`/sequence/edit/:id`)
- [`view-editor`](./view-editor.md) — DB ビュー編集 (`/view/edit/:id`)
- [`view-definition-editor`](./view-definition-editor.md) — ViewDefinition 編集 (`/view-definition/edit/:id`)
- [`page-layout-editor`](./page-layout-editor.md) — ページレイアウト編集 (`/page-layout/edit/:id`)
- [`page-layout-designer`](./page-layout-designer.md) — 互換 redirect (`/page-layout/design/:id` → `/page-layout/edit/:id`)
- [`generic-definition-list`](./generic-definition-list.md) — 汎用定義一覧 (kind 単位) (`/generic-definition/:kind`)
- [`generic-definition-editor`](./generic-definition-editor.md) — 汎用定義編集 (`/generic-definition/:kind/:name`)

### D. 設定・管理

プロジェクト全体の設定 / 拡張管理画面。

- [`extensions`](./extensions.md) — 拡張管理 (`/extensions`)
- [`tech-stack`](./tech-stack.md) — 技術スタック選定 (`/project/tech-stack`)
- [`workspace-list`](./workspace-list.md) — ワークスペース一覧 (`/workspace/list`, top-level)
- [`ai-settings`](./ai-settings.md) — AI 設定 (`/ai-settings`, top-level)

## メンテナンス

### 新しい画面 (route) を追加したら

1. AGENTS.md の "Routing" 表に追記
2. `ai-skills/document-ui/SKILL.md` の画面カテゴリ表に screen-key を追加
3. 本 README の対応カテゴリにエントリ追加
4. `/document-ui <screen-key>` で md + screenshot を生成
5. `cd docs-site && npm run build` で HTML 反映

### 画面の UI を変更したら

1. PR 内で `/document-ui <screen-key>` を実行 (該当画面のみ)
2. screenshot + md の diff を確認、不要な差分は revert
3. `cd docs-site && npm run build`
4. 同 PR にまとめて commit

### 全画面の screenshot を最新化したい時

```
/document-ui
```

(全画面を順次撮影 + md 再生成、所要時間: 1-2 時間目安。実機 dev server 起動 + dogfood-uidoc-* workspace 前提)

## 関連

- 生成スキル: [`ai-skills/document-ui/SKILL.md`](../../../ai-skills/document-ui/SKILL.md)
- ルーティング正本: [AGENTS.md](../../../AGENTS.md) の "Routing" セクション
- 一覧 UI 共通仕様: [`docs/spec/list-common.md`](../../spec/list-common.md)
- 画面デザイナー仕様: [`docs/spec/screen-layout.md`](../../spec/screen-layout.md)
- ページレイアウト仕様: [`docs/spec/page-layout.md`](../../spec/page-layout.md)
