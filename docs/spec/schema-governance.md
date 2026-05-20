# Schema Governance — グローバル定義スキーマ変更ガバナンス

本フレームワークの**最重要原則**を定める。

## 1. 変更権限の階層

| 領域 | ファイル例 | 変更権限 |
|---|---|---|
| **グローバル定義スキーマ** | `schemas/v3/process-flow.v3.schema.json` / `schemas/v3/extensions.v3.schema.json` / `schemas/v3/conventions.v3.schema.json` | **フレームワーク製作者 (設計者) の専権** |
| **拡張定義 (namespace)** | `examples/<project-id>/harmony/extensions/<namespace>.v3.json` / `workspaces/<id>/<dataDir>/extensions/<namespace>.v3.json` | 業務開発者 (AI 含む) |
| **業務規約 catalog** | `examples/<project-id>/harmony/conventions/catalog.json` | 業務開発者 (AI 含む) |
| **業務データ JSON** | 処理フロー / テーブル定義 / 画面項目定義 等 | 業務開発者 (AI 含む) |

**核心原則**: グローバル定義スキーマは本フレームワークの**統一性 / 互換性 / 価値の根幹**。各業務開発者が勝手に拡張すると:

- schema が業界別都合の寄せ集めになり、統一思想を失う
- 後発業務との非互換 / 互換性壊れの混入
- 設計者の意図しない構造変更でフレームワーク全体の信頼性低下
- フレームワークの価値失墜

## 2. AI (Claude/Codex/Opus 等) に対する禁止事項

### 禁止行為

- `schemas/v3/process-flow.v3.schema.json` の編集 (フィールド追加 / enum 値追加 / oneOf バリアント追加 / 構造変更)
- `schemas/v3/extensions.v3.schema.json` の編集
- `schemas/v3/conventions.v3.schema.json` の編集
- `Step.oneOf` / `OtherStep` / `TransactionScope` 等の core 構造変更

### 許可される変更 (拡張機構経由)

- `examples/<project-id>/harmony/extensions/<namespace>.v3.json` の追加・編集
- `workspaces/<id>/<dataDir>/extensions/<namespace>.v3.json` の追加・編集 (実プロジェクト、`dataDir` は `harmony.json` で定義)
- `examples/<project-id>/harmony/conventions/catalog.json` の値追加 (catalog 拡充)
- 処理フロー JSON / テーブル定義 JSON 等の業務データ

## 3. グローバル schema 変更が必要な場合の手順

業務記述で「拡張機構では表現できない」要素が出てきた場合:

### Step 1: 代替手段の確認 (まず試すべきこと)

1. **拡張機構 (namespace)** で表現できないか?
   - 新しい field-type / trigger / db-operation / step を `extensions/<namespace>/*.json` に追加
2. **既存 schema フィールド**で代替表現できないか?
   - `type: "other"` + `outputSchema` + description 注記 で意図を表現
   - description / note フィールドで業務意図を補足
3. **業務規約 catalog** に追加することで解決できないか?
   - `@conv.*` 参照を増やすことで業務側で対応

### Step 2: それでも必要な場合 — 作業停止 + ISSUE 起票

AI は実装中に「グローバル schema を変更しないと表現できない」と気付いた時点で:

1. **即座に作業停止** (テスト pass を理由に勝手に拡張しない)
2. **別 ISSUE 起票**:
   ```
   タイトル: improve(schema): <フィールド名> 追加検討 — <経緯>
   本文:
     - 何のフィールド / 構造を追加したいか
     - なぜ拡張機構 (namespace) で表現できないか
     - 既存 schema 表現で代替できないか (回避案を試行した結果)
     - 影響範囲 (既存サンプル / 拡張への影響、後方互換性)
     - 緊急度・代替案
   ```
3. **設計者 (ユーザー) のレビューを待つ**
4. 元のサンプル/フロー作業は:
   - 代替表現で完成させる、もしくは
   - schema 改修 PR マージ後に再開

### Step 3: 設計者の判断

設計者は以下を確認して承認 / 拒否 / 改善要求:

- 本当に拡張機構で代替できないか
- spec 全体の思想と整合するか ([`schema-design-principles.md`](schema-design-principles.md) (#517 で起草済み) 参照)
- 既存サンプルへの影響 (regression リスク)
- 命名規約に準拠しているか
- 後方互換性が保たれているか

承認された場合は専用 PR で:
- schema 改修
- 関連 spec 文書の更新
- SKILL の更新 (該当ルール)
- testCase 追加 (新規 schema フィールドを valid とする / 不正形式を invalid とする)

## 4. 検出の仕組み (CI / Orchestrator チェック)

### `/issues` オーケストレーター (`/issues <N>`)

PR 作成後に必ず:

```bash
gh pr diff <PR番号> --name-only | grep -E "^schemas/"
```

変更がある場合:
- 設計者承認 ISSUE が紐付いているかを確認
- 紐付かない schema 変更は **即座に Codex/Sonnet に revert 指示**
- もしくは別 ISSUE 起票で隔離 (現 PR からは schema 変更を取り除く)
- 紐付かない schema 変更を含む PR は **マージ禁止**

### `/review-pr` PR 独立レビュー

PR の Step 5 (新設) で schema 変更チェック:

- 設計者承認の紐付き確認
- 拡張機構 / 既存表現での代替可能性検討
- 紐付かない場合は **必ず Must-fix として指摘**

### `/create-flow` 作成時 (Rule 15)

ProcessFlow JSON 作成時の self-check に「グローバル schema を変更しない」を必須項目として組み込み。

## 5. 過去事例 (教訓)

### 正当な変更 (例: PR #494 / #492 namespace:StepName 改修)

- 別 ISSUE で明示的に決定
- spec 改訂 / SKILL 更新 / testCase 追加が一括で行われた
- 設計者の意図と整合

### 不正当な変更 (例: PR #508 / #506 retail ラウンド 3)

- Sonnet が修正中に schema 6 フィールドを勝手に追加
- 設計者承認なしで通過 (#511 ガバナンス導入の発端)
- 内容: `patternRef`, `ngEventPublish`, `object[]` 型, `responseSchema`, `CacheHint.note`, `ElseBranch.description`
- 後日 (Phase B-1 で) 適切性を再評価予定

### 判断保留が必要 (例: PR #469 / #463 — Codex の `outputSchema` / `outcomes` 追加)

- Codex 実装中に schema 拡張、レビューで承認されたが正式設計プロセスを経ていない
- Phase B-1 で再レビュー対象

## 6. 関連ドキュメント

- 設計思想: [`docs/spec/schema-design-principles.md`](schema-design-principles.md) (#517 で起草済み)
- 過去変更レビュー (将来): Phase B-1 ISSUE 起票時に作成

(注: AI 用の per-user 永続メモリは Claude Code が自動管理。本仕様書は git 管理 docs として自己完結する。)

## 7. 例外規定

設計者自身による直接編集は本ガバナンスの対象外 (フレームワーク製作者の専権)。

緊急 hotfix で AI が schema 変更を行う必要がある場合は、ユーザー (設計者) からの**明示的な指示**があった場合に限り許容。指示なしで AI 判断で行うのは禁止。

## 8. 違反時の対応

PR で schema 変更が検出され、紐付き設計者承認 ISSUE がない場合:

1. 該当 PR にコメント: `⚠️ schema 変更検出: 設計者承認が必要、現状 NG`
2. 以下のいずれかを実施:
   - **revert + 元の修正 PR に schema 変更を含めず再 push**
   - **別 ISSUE 起票** (`improve(schema): ...`) して schema 変更を隔離、現 PR からは除外
3. ISSUE が承認されたら schema 専用 PR で対応

これにより業務修正 PR と schema 改修 PR を分離し、レビュー粒度を明確化。

---

**本ドキュメントは本フレームワークの設計思想を守る最重要ガバナンス**。AI / 業務開発者 全員の遵守を前提とする。
