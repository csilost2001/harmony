---
name: import-md
description: Project の Markdown 設計書を Harmony JSON に変換する。MD inventory → archetype 分類 → entity/generic-definition mapping → audit を実施。MD が多い or 継続更新がある project は `scripts/import/*.ts` を生成、少数 1 回限りなら直接変換
argument-hint: <project ディレクトリのパス> (例: examples/retail or workspaces/my-project)
---

<!--
  使い方:
    - `/import-md examples/retail` のように project ディレクトリを指定
    - 引数なしで起動した場合は active workspace を対象に
    - 結果: Harmony JSON 群 + audit.json + (option) scripts/import/*.ts

  目的:
    - 既存 Markdown 設計書を Harmony 構造に取り込む
    - 共通変換手順を AI に渡し、drift を抑える
    - 必要に応じ project 固有 importer を生成

  発動制御:
    - description に "Markdown 設計書" "Harmony JSON" "変換" のキーワードで自動起動許容
    - 明示呼び出し `/import-md <path>` も可
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

- `$ARGUMENTS` が空の場合は active workspace を対象にする (backend API or `workspaces/` 配下の latest)
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
- `componentCall.componentRef` / `exceptionTypeRef` は最後に解決
- 1 ファイルずつ順次変換 (batch 処理は禁止、§8 落とし穴回避)

### Step 4: 既知落とし穴の事前回避

[`conversion-guideline-for-ai.md` §8](../../../docs/spec/conversion-guideline-for-ai.md) の落とし穴 8 種を変換前に頭に入れる。特に:

- ProcessFlow: conv リテラル化 / 複数 kind / TX rollbackOn 欠落
- ScreenItem: 現行 schema では binding 情報を `description` に **`key=value; key=value;` 形式** で構造化退避 (自由文埋もれは禁止 — RFC 将来 schema 確定後の `binding` field 自動 migrate を壊さないため)
- SQL: alias 必須化

### Step 5: AJV 検証 + audit summary 出力

- `schemas/v3/*.json` 配下の現行 schema で生成した JSON を全件 AJV validate (§10 (A) hard gate)
- `examples/<project>/generic-definitions/<kind>/*.json` 配下は **AJV 対象外**、`rfc_future_field_skipped` warning として kind 別件数を記録 (§10 (B) soft gate)
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
- schema governance に抵触する schema 拡張が必要だと判明したら **作業停止して ISSUE 起票** 提案

## 注意

- 本 skill は **AI 向けマニュアル ([`conversion-guideline-for-ai.md`](../../../docs/spec/conversion-guideline-for-ai.md)) の起動点** に過ぎない。実体は spec 側にある
- spec を読まずに skill 手順だけで変換するのは禁止 (落とし穴を踏む)
- パターン (B) で `scripts/import/*.ts` を生成する場合、TS scaffold は spec §7.2 のテンプレを起点にする
