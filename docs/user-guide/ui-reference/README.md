# UI 操作リファレンス

Harmony の各 UI 画面の操作マニュアル。**エンドユーザー (業務設計者・実装者) 向け**で、目的・到達経路・主要操作・データ前提・screenshot を画面単位でまとめる。

## このディレクトリの位置付け

- **canonical**: 本 README (index) + `<screen-key>.md` (各画面 1 ファイル)
- **screenshot**: `docs/ui-screenshots/ui-reference/<screen-key>/*.png`
- **build artifact**: `docs/html/user-guide/ui-reference/` (docs-site rebuild で生成、手編集禁止)
- **生成 / 更新スキル**: `/document-ui` (`ai-skills/document-ui/SKILL.md`)

仕様書 (`docs/spec/`) は設計者・実装者向けで、本ディレクトリは **画面の使い方** にフォーカス。両者で重複する内容 (例: ProcessFlow の variable lifecycle) は spec を canonical とし、本書からはリンクのみ張る。

## ステータス凡例

各画面の項目には以下のいずれかが付く:

- **✅ 完備**: md + screenshot 揃い、リンク有効
- **⏳ 準備中**: 未生成、follow-up で `/document-ui <screen-key>` 実行予定 (本 PR の PoC スコープ外)

## 画面カテゴリ

ルーティングは AGENTS.md の "Routing" 表 が canonical。

### A. ダッシュボード・全体俯瞰

プロジェクト全体の状態を俯瞰する画面群。最初に開く / 全体把握用。

- ✅ [`dashboard`](./dashboard.md) — Dashboard (`/`): プロジェクト全体俯瞰
- ⏳ `screen-flow` — 画面フロー図 (`/screen/flow`): ReactFlow キャンバスで画面遷移を表示
- ⏳ `er-diagram` — ER 図 (`/table/er`): テーブル関連を mermaid で可視化
- ⏳ `generic-definition-catalog` — 汎用定義カタログ (`/generic-definition`)
- ⏳ `conventions-catalog` — 横断規約カタログ (`/conventions/catalog`)

### B. リソース一覧

各リソース種別の一覧画面。共通仕様は [`docs/spec/list-common.md`](../../spec/list-common.md) 参照。

- ✅ [`screen-list`](./screen-list.md) — 画面一覧 (`/screen/list`)
- ⏳ `table-list` — テーブル一覧 (`/table/list`)
- ⏳ `process-flow-list` — 処理フロー一覧 (`/process-flow/list`)
- ⏳ `sequence-list` — シーケンス一覧 (`/sequence/list`)
- ⏳ `view-list` — DB ビュー一覧 (`/view/list`)
- ⏳ `view-definition-list` — ViewDefinition 一覧 (`/view-definition/list`)
- ⏳ `page-layout-list` — ページレイアウト一覧 (`/page-layout/list`)
- ⏳ `gadget-list` — ガジェット一覧 (`/gadget/list`)

### C. リソース個別エディタ

各リソースを編集する画面。リソース ID 単位でタブが開く (per-resource)。

- ⏳ `screen-designer` — 画面デザイナー (GrapesJS) (`/screen/design/:id`)
- ⏳ `screen-items` — 画面項目編集 (`/screen/items/:id`)
- ⏳ `table-editor` — テーブル定義編集 (`/table/edit/:id`)
- ✅ [`process-flow-editor`](./process-flow-editor.md) — 処理フロー編集 (`/process-flow/edit/:id`)
- ⏳ `sequence-editor` — シーケンス編集 (`/sequence/edit/:id`)
- ⏳ `view-editor` — DB ビュー編集 (`/view/edit/:id`)
- ⏳ `view-definition-editor` — ViewDefinition 編集 (`/view-definition/edit/:id`)
- ⏳ `page-layout-editor` — ページレイアウト編集 (`/page-layout/edit/:id`)
- ⏳ `page-layout-designer` — ページレイアウト Designer (`/page-layout/design/:id`)
- ⏳ `generic-definition-list` — 汎用定義一覧 (kind 単位) (`/generic-definition/:kind`)
- ⏳ `generic-definition-editor` — 汎用定義編集 (`/generic-definition/:kind/:name`)

### D. 設定・管理

プロジェクト全体の設定 / 拡張管理画面。

- ⏳ `extensions` — 拡張管理 (`/extensions`)
- ⏳ `tech-stack` — 技術スタック選定 (`/project/tech-stack`)
- ⏳ `workspace-list` — ワークスペース一覧 (`/workspace/list`)
- ⏳ `ai-settings` — AI 設定 (`/ai-settings`)

## メンテナンス

### 新しい画面 (route) を追加したら

1. AGENTS.md の "Routing" 表に追記
2. `ai-skills/document-ui/SKILL.md` の画面カテゴリ表に screen-key を追加
3. 本 README の対応カテゴリにエントリ追加 (初期は ⏳ 準備中)
4. `/document-ui <screen-key>` で md + screenshot を生成 (生成後 ✅ に切替)
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

(全 28 画面を順次撮影 + md 再生成、所要時間: 14-28 時間目安。実機 dev server 起動 + dogfood-uidoc-* workspace 前提)

## 関連

- 生成スキル: [`ai-skills/document-ui/SKILL.md`](../../../ai-skills/document-ui/SKILL.md)
- ルーティング正本: [AGENTS.md](../../../AGENTS.md) の "Routing" セクション
- 一覧 UI 共通仕様: [`docs/spec/list-common.md`](../../spec/list-common.md)
- 画面デザイナー仕様: [`docs/spec/multi-editor-puck.md`](../../spec/multi-editor-puck.md)
- ページレイアウト仕様: [`docs/spec/page-layout.md`](../../spec/page-layout.md)
