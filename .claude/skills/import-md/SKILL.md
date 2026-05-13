---
name: import-md
description: Project ディレクトリが指定され、その配下の Markdown 設計書を Harmony JSON 成果物に変換するよう明示的に依頼された場合のみ実行。MD inventory → archetype 分類 → entity/generic-definition mapping → audit。説明・レビュー・調査用途では起動しない (引数なし / 既存 Harmony JSON への質問 / spec 説明依頼は対象外)
argument-hint: <project ディレクトリのパス> (例: examples/retail or workspaces/my-project)
---

<!--
  使い方:
    - `/import-md examples/retail` のように project ディレクトリを指定
    - 引数必須 (description 末尾の絞り込み条件と整合、引数なし運用は廃止)
    - 結果: Harmony JSON 群 + audit.json + (option) scripts/import/*.ts

  目的:
    - 既存 Markdown 設計書を Harmony 構造に取り込む
    - 共通変換手順を AI に渡し、drift を抑える
    - 必要に応じ project 固有 importer を生成

  発動制御:
    - **明示呼び出し** `/import-md <project-dir>` を優先
    - 自動起動は description 末尾の絞り込み条件 (project ディレクトリ指定 + MD→JSON 成果物生成依頼) を満たす場合のみ
    - 「MD を Harmony 形式で説明して」「過去変換例の解説」「spec の理解確認」等では起動しない
-->

Project ディレクトリ `$ARGUMENTS` の Markdown 設計書を Harmony JSON に変換してください。

## 必読 spec

着手前に **必ず** 次を読む:

1. **[`docs/spec/conversion-guideline-for-ai.md`](../../../docs/spec/conversion-guideline-for-ai.md)** — メインのガイドライン (本 skill の中身はこの spec に集約)
   - **特に §0.5 「⚠️ 本ガイドラインの schema 状態」は必読**。現行 schema 適合形 (✅) と RFC 将来案 (✨) の区別を理解しないまま着手すると、AJV gate で必ず失敗する
2. [`docs/spec/generic-definition-layer.md`](../../../docs/spec/generic-definition-layer.md) — Generic Definition Catalog の 8 kind / 共通メタモデル
3. [`docs/spec/schema-governance.md`](../../../docs/spec/schema-governance.md) — 既存 schema を勝手に拡張しないルール
4. [`docs/spec/draft-state-policy.md`](../../../docs/spec/draft-state-policy.md) — warning 残存保存の規範

ガイドラインを最後まで読まずに変換を開始するのは禁止。読み終わったら本 skill 末尾の手順に進む。

## 手順

### Step 0: 前提確認

- `$ARGUMENTS` が空の場合は **エラー終了** — project ディレクトリを明示指定するようユーザーに案内 (description / 発動制御と整合)
- 引数の project ディレクトリに `harmony.json` があることを確認、`dataDir` を取得して出力先を決定
- MD ファイルの場所を特定 (典型: `<project>/reference/**/*.md`)

### Step 1: 規模・状況の見極め (Decision flowchart)

[`conversion-guideline-for-ai.md` §9](../../../docs/spec/conversion-guideline-for-ai.md) のフローチャートに従い、以下を判断:

- パターン (A) 1 回限り変換 — MD が少数 + 更新まれ
- パターン (B) Importer 生成 — MD が多い or 継続更新

判断結果と理由を **ユーザーに明示** してから着手。判断が微妙ならユーザー確認。

### Step 2: 既存 import-project-profile.json の有無確認

- `<project>/import-project-profile.json` があれば読み込み、変換ルールに使う
- 無くてもガイドラインだけで変換可能 (profile は optional)
- パターン (B) の場合は変換完了後に profile を **AI 解釈の還元結果** として書き出す

### Step 3: 変換実行

[`conversion-guideline-for-ai.md` §6 (パターン A)](../../../docs/spec/conversion-guideline-for-ai.md) または [§7 (パターン B)](../../../docs/spec/conversion-guideline-for-ai.md) の手順に従う。

要点:
- catalog 系 (`pulldown-catalog` / `reference-catalog`) を最初に処理して conventions を確立
- screen / processFlow / table → generic-definitions の順
- 現行 schema で表現できる内部共通処理参照は `commonProcess.refId` を解決する (existing step kind)
- `componentCall.componentRef` / `validation[].throw.exceptionTypeRef` は RFC 将来 field — 現行 `schemas/v3/*.json` に存在しないため **現行 ProcessFlow JSON には生成しない**。退避先は §0.5「AI が今すべきこと」(2) に従い (a) `description` 構造化退避 / (b) `extensions/<namespace>/*.json` / (c) `generic-definitions/<kind>/*.json` + `rfc_future_field_skipped` warning のいずれか
- 1 ファイルずつ順次変換 (batch 処理は禁止、§8 落とし穴回避)

### Step 4: 既知落とし穴の事前回避

[`conversion-guideline-for-ai.md` §8](../../../docs/spec/conversion-guideline-for-ai.md) の落とし穴一覧 (§8.1〜§8.6 の各サブセクション) を変換前に頭に入れる。特に:

- ProcessFlow: conv リテラル化 / 複数 kind / TX rollbackOn 欠落
- ScreenItem: 現行 schema では binding 情報を `description` に **`[binding.v1] binding.attr=<attr>; binding.path=<path>; ...` 形式** (sentinel + key=value セミコロン区切り) で構造化退避。sentinel `[binding.v1] ` 必須。自由文埋もれは禁止 — RFC 将来 schema 確定後の `binding` field 自動 migrate を壊さないため。詳細は spec §3.1 / §8.2 参照
- SQL: alias 必須化

### Step 5: AJV 検証 + audit summary 出力

- `schemas/v3/*.json` 配下の現行 schema で生成した JSON を全件 AJV validate (§10 (A) hard gate)。実行: `cd frontend && npm run validate:samples -- ../<project-dir>`
- `<project>/<dataDir>/generic-definitions/<kind>/*.json` 配下 (例: `examples/retail/harmony/generic-definitions/...`) は **親 schema (`generic-definition.v3.schema.json`、#1063) で AJV 検証対象**。物理配置の path ↔ kind 一致は `node scripts/spec-check/lint-generic-definitions.mjs <project-dir>` で soft lint 併用。data-contract / domain-type kind 別 schema による strict 検証は #1064 で導入済 (test.mjs § 3c)、残 6 kind は #1066-#1068 (§10 (B))
- `rfc_future_field_skipped` warning は kind 別件数を audit に記録
- audit.json を [`conversion-guideline-for-ai.md` §5.3](../../../docs/spec/conversion-guideline-for-ai.md) 形式で出力
- `severity: "error"` 0 件、coverage 95% 以上を確認

### Step 6: 報告

ユーザーに以下を報告:

1. パターン (A/B) と選択理由
2. 変換対象 MD 件数 + archetype 内訳
3. 生成 Harmony JSON 件数 (entity 別 + generic-definition kind 別)
4. AJV validation 結果 (passed / failed 件数)
5. warning 一覧 (kind 別件数)
6. coverage
7. パターン (B) の場合: 生成した `scripts/import/*.ts` の一覧
8. draft-state policy に基づく残課題 (warning 残存 / error 残存)

### 失敗時の挙動

- 変換不能な MD があれば warning として残し、強引な推測はしない
- AJV failed が出たら **そのまま保存せず** 修正案をユーザーに提示
- schema governance に抵触する schema 拡張が必要だと判明したら、**AGENTS.md「ISSUE 起票の鉄則」(鉄則 0/1/2/3 と起票直前 self-check 6 項目) に従う**:
  1. まず本 PR / follow-up small PR で吸収不可かを確認 (鉄則 1)
  2. 吸収不可なら新規 ISSUE 起票するが、放置は絶対禁止 (鉄則 0)
  3. 同根の課題があれば 1 ISSUE に統合 (鉄則 3)
  4. 「念のため別 ISSUE で隔離」「将来対応のためメモ」等の禁止理由付けに陥らない

## 注意

- 本 skill は **AI 向けマニュアル ([`conversion-guideline-for-ai.md`](../../../docs/spec/conversion-guideline-for-ai.md)) の起動点** に過ぎない。実体は spec 側にある
- spec を読まずに skill 手順だけで変換するのは禁止 (落とし穴を踏む)
- パターン (B) で `scripts/import/*.ts` を生成する場合、TS scaffold は spec §7.2 のテンプレを起点にする
