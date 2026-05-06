# Phase Dogfood: retail サンプル実機 smoke (#711) — 2026-05-02

## 概要

PR #710 (#709) で完了した retail サンプル品質保証の **実機 UI smoke 検証フェーズ**。validate:samples / /review-flow 等の機械検証は all green だが、designer UI で実際に開いて確認する dogfood が未実施だったため #711 で実施した。

## 実施手順

1. examples/retail/* を data/ にコピー (デプロイ相当)
2. backend + designer 起動 (常駐済)
3. chrome-devtools MCP で http://localhost:5173/ を開き、recent workspace から retail 選択
4. 11 画面 + 4 process flow + 5 view-definition + 3 sequence の閲覧確認

## 結果

機械検証では検出できなかった **2 件の Critical 構造問題**を発見。

### Finding #1: screen-items が runtime に読まれない

**症状**: 11 画面すべてで loadScreenItems API が `{items: []}` を返す。UI で空フォーム表示。

**原因**:
- v3 schema (`schemas/v3/screen.v3.schema.json:29-32`) の規定: `Screen.items: ScreenItem[]` は screen entity に embedded array
- examples/retail 実装: 別ファイル `screen-items/<screenId>.json` に **1 ファイル = 単一 screen-item** 形式
- runtime (`backend/src/projectStorage.ts:516 readScreenItems()`): screen entity の `items` 配列を直接読む。別ファイルは migration 経由でのみ読む (entity に items / design 等が存在すると migration スキップされ、別ファイル無視)

**追加観測**: 各画面 1 ファイルで item 1 個のみ宣言 = 業務的にも内容不足 (例: 商品検索画面に productCode 1 個のみで storeCode / searchButton 等が未定義)

→ #712 で修正

### Finding #2: design HTML が runtime に読まれない

**症状**: 11 画面すべてで loadScreen API が `null` を返す。UI で空キャンバス表示。

**原因**:
- v3 schema (`schemas/v3/screen.v3.schema.json:68-77`) の ScreenDesign 定義: 「生 HTML/CSS/component tree は別ファイル (`data/screens/<id>.design.json`) で管理」
- examples/retail 実装: raw HTML を `designs/<id>.html` に配置 (別ディレクトリ、別拡張子)
- runtime (`backend/src/projectStorage.ts:251, 334`): `screens/<id>.design.json` を hard-code で読む。`Screen.design.designFileRef` の値は無視

→ #713 で修正

## 機械検証で確認できた項目 (再掲)

- ✅ Workspace メタ (title / counts) ロード OK
- ✅ Screen list view は 11 画面表示
- ✅ Process flow editor は 4 flow ロード (loadProcessFlow)
- ✅ Sequence は 3 件ロード
- ✅ ViewDefinition は 5 件ロード
- ✅ Table list は 8 件
- ✅ View list は 4 件
- ✅ project.json の entities.screens / .tables / .processFlows / .viewDefinitions / .sequences / .views カウント完全一致

## 失敗観点 (UI 表示までは未確認)

- ❌ 画面項目定義 (form フィールド) UI 表示 — Finding #1 で空フォーム
- ❌ 画面デザイン (HTML) UI 表示 — Finding #2 で空キャンバス
- 編集モード / 保存・破棄 smoke は UI 表示が破綻しているため実施保留

## 教訓 (memory に追記済)

memory `feedback_validate_samples_blind_spots.md`:

> **schema validation + /review-flow pass でも runtime 契約 (storage layer の path/format 期待) を満たさないと UI で何も表示されない**。dogfood は機械検証 + 実機 smoke の二段必須。

## 追加した follow-up ISSUE

- **#712**: retail screen-items を v3 schema 準拠で screen entity に embed
- **#713**: retail designs を GrapesJS JSON wrapper に変換
- **#714**: validate-samples.ts に runtime 契約整合性チェック追加 (上記盲点の機械検出)

## #711 のスコープ確定

実機 smoke の受入基準 (11 画面表示 / 編集 / 保存 等) は **#712 / #713 完了後に再評価** する。本 ISSUE は smoke レポート + memory 追記 + follow-up ISSUE 起票で完了とする。

## 関連

- 親 PR: #710 (#709) — retail サンプル品質保証 (機械検証完遂)
- メタ: #680 (samples 業界別整備)
- 元 ISSUE: #709 (機械検証)
- 後続: #712 / #713 / #714
- spec: schemas/v3/screen.v3.schema.json
- runtime: backend/src/projectStorage.ts
