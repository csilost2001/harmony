# Markdown → Harmony JSON 共通 Importer 手順書

**Status**: 🟡 **draft v0.1 (RFC)** — `generic-definition-layer.md` Layer 3 の独立化
**起票 ISSUE**: #1060
**親 spec**: [`generic-definition-layer.md`](generic-definition-layer.md)
**起票日**: 2026-05-13

---

## 1. 目的

Markdown 設計書 → Harmony JSON 変換を **全プロジェクト共通の標準フロー** で実施し、AI による自由解釈の drift を抑える。

### 責務分担

| 担当 | 持ち物 |
|---|---|
| **Harmony 側** | 本手順書 / 共通 audit ルール / 共通 schema / generic definition 方針 |
| **Project 側** | `import-project-profile.json` (差分のみ記述) |
| **AI** | 初回の未知パターン解釈 + その結果の profile への還元 |

「共通手順書は Harmony 側、project 差分は profile、新パターンは AI が解釈し profile に還元」が 3 者の境界。

---

## 2. 標準フロー (10 ステップ)

```
[input] reference/**/*.md + project profile
    │
    ▼
[1] inventory  →  inventory.json (中間成果物、原文不変)
    ▼
[2] archetype 分類
    ▼
[3] heading / table 正規化  (profile.headingAliases で上書き)
    ▼
[4] entity mapping  →  screen / processFlow / table / viewDefinition / screenTransition / conventions
    ▼
[5] generic definition 退避  →  generic-definitions/<kind>/*.json
    ▼
[6] warning / audit 出力  →  audit.json
    ▼
[7] deterministic 再実行  ←  同 MD + 同 profile = 同 JSON
    ▼
[8] schema validation (AJV) + audit summary
    ▼
[9] human review gate  (warning しきい値超過時は完了扱いにしない)
    ▼
[10] profile feedback loop  →  AI 初回解釈を profile に静的ルール化
```

### Step 1: 文書 inventory

**入力**: project profile の `sourceInventory.{rootDirs, includeGlobs, excludeGlobs, priorityDocuments}`

**処理**:
- 対象 Markdown を全件列挙
- 1 ファイルあたり次を収集: `path` / `fileName` / `mtime` / `headings[]` (見出し一覧) / `tables[][]` (テーブルヘッダ一覧) / `archetypeCandidate` (file name regex 推定)
- `priorityDocuments` 一致ファイルは順序を優先

**出力**: `inventory.json` (中間成果物、原文は不変)

**契約**:
- 同じディレクトリ + 同じ profile なら **必ず同じ inventory.json** (再実行決定性の前提)
- 原文を改変しない

### Step 2: archetype 分類

**入力**: inventory.json + profile.fileNaming.archetypeHints + profile.archetypeRules

**処理**:
1. file name regex (`profile.fileNaming.archetypeHints[].whenFileNameMatches`) で 1 次分類
2. heading 一致 (`profile.archetypeRules[].whenHeadingsContain`) で 2 次分類 (1 次と異なる場合は warning)
3. 分類できないものは `archetype: "unknown"` で残す (強引な推定はしない)

**標準 archetype 一覧**:
- `screen-controller` — 画面 Controller 文書
- `service-flow-spec` — Service / メソッド単位の処理フロー
- `architecture-spec` — Controller/Service/Mapper 等の責務分割
- `frontend-script` — 共通 JS / 画面横断振る舞い
- `configuration-class` — 設定 / 認証認可 / AOP
- `exception-model` — 例外体系
- `class-definition` — DTO / Result / Utility 等
- `reference-catalog` — メッセージ / 定数 / システム設定
- `pulldown-catalog` — pulldown / enum / コードマスタ
- `unknown` — 未分類

**出力**: inventory.json に `archetype` フィールドを追加

### Step 3: heading / table 正規化

**入力**: inventory.json + profile.headingAliases + profile.tableHeaderAliases

**処理**:
- 別名見出し (例: `コントロールマッピング` / `画面項目マッピング` / `画面項目定義`) を正規名 `controlMapping` に統一
- 表ヘッダ揺れ (列順違い・列名違い) を正規セットに統一
- 番号付き見出し (`1. 画面項目定義` 等) は番号を除去して比較

**出力**: 正規化済み inventory.json

### Step 4: entity mapping (既存 entity 優先)

「既存 entity で済むものは無理に新 entity 化しない」原則 (`generic-definition-layer.md` §6) に従い、まず既存 entity への変換を試みる。

| archetype | 既存 entity 変換先 | 主な情報源 |
|---|---|---|
| `screen-controller` | `screen.json` + `screen-item` | controlMapping table |
| `service-flow-spec` | `process-flow.json` | processOverview heading + method table |
| `architecture-spec` | (補完情報、複数 entity への metadata 追加) | 責務分割表 |
| `exception-model` | (Layer 2 へ、Step 5) | 例外一覧表 |
| `class-definition` | (Layer 2 へ、Step 5) | クラス責務表 |
| `configuration-class` | (Layer 2 へ、Step 5) | アノテーション + 依存性注入表 |
| `frontend-script` | (Layer 2 へ、Step 5) | 関数一覧 + 効果表 |
| `reference-catalog` | `conventions.json` の messages / constants | catalog 表 |
| `pulldown-catalog` | `conventions.json` の codeMaster / extensions catalog | enum 表 |

**契約**:
- ScreenItem の binding 情報は (本 PR 後) Layer 1 §3.1 構造化 field を使う
- 未表現の情報は説明文に逃さず Step 6 で warning として明示

### Step 5: generic definition 退避

既存 entity に自然に属さないものを `generic-definition-layer.md` §4.2 の 8 kind に変換:

| archetype | 退避先 kind | 例 |
|---|---|---|
| `class-definition` (DTO/Form/Result) | `data-contract` | OrderForm / SearchResultDto |
| `class-definition` (Entity/Model) | `domain-type` | Customer / Account |
| `exception-model` | `exception-type` | ValidationException / BusinessAbortException |
| `configuration-class` | `application-rule` | SecurityConfig / LoggingConfig |
| `frontend-script` | `ui-behavior` | dirtyCheck / dialogShow / datepicker |
| `architecture-spec` (service/mapper) | `component-definition` | OrderService / OrderMapper |
| (UI ヘッダー / フッター / メッセージ領域 / アップロード行) | `ui-fragment` | commonHeader / messageArea |
| (retry / timeout / circuit breaker) | `runtime-policy` | externalRetryPolicy |

profile の `reusableContracts.promoteKinds` + `reusableContracts.dataContractKinds` で分類ルールを上書き可能。

### Step 6: warning / audit 出力

**出力**: `audit.json`

各 warning は最低限以下を含む:

```json
{
  "file": "reference/spec_Pulldown_xxx.md",
  "section": "画面項目定義 / 申込理由",
  "reason": "missing_binding_source",
  "suggestedTargetEntity": "screen-item.binding",
  "severity": "warning" | "error",
  "humanReadable": "申込理由の binding source が見つかりません。screen-item の binding.kind が決定不能です。"
}
```

**標準 warning 種別**:
- `unknown_archetype` — Step 2 で分類不能
- `generated_screen_items_zero` — Step 4 で画面項目が 1 つも抽出できなかった
- `missing_binding_source` — Step 4 で binding kind が決定不能
- `unsupported_harmony_entity` — Step 4/5 のどちらにも落ちない情報
- `heading_alias_unmatched` — Step 3 で別名一致しなかった見出し
- `table_header_drift` — Step 3 で表ヘッダ揺れが profile に未登録
- `inconsistent_archetype_classification` — Step 2 で file name と heading の archetype が不一致

### Step 7: deterministic 再実行

**契約**: 同 MD + 同 profile → 必ず同じ Harmony JSON (一字一句)

**実装要件**:
- AI 出力は profile に還元してから再実行 (Step 10)
- ファイル順は inventory.json の順序に固定
- JSON 出力は安定 sort (キー alphabetical / 配列順序は意味順)

### Step 8: schema validation + audit summary

**入力**: 生成した全 Harmony JSON + audit.json

**処理**:
- AJV で全 entity を schema validation
- audit summary を生成:

```json
{
  "totalDocuments": 142,
  "archetypeBreakdown": {
    "screen-controller": 45,
    "service-flow-spec": 67,
    "exception-model": 3,
    "unknown": 2
  },
  "generatedEntities": {
    "screen": 45,
    "processFlow": 67,
    "table": 12,
    "genericDefinition": {
      "data-contract": 23,
      "exception-type": 8,
      "ui-behavior": 5
    }
  },
  "warnings": {
    "byKind": { "missing_binding_source": 12, "unknown_archetype": 2 },
    "total": 14
  },
  "coverage": {
    "screenControllers": 0.97,
    "serviceFlowSpecs": 0.98,
    "referenceCatalogs": 1.0
  },
  "schemaValidation": { "passed": 158, "failed": 2 }
}
```

### Step 9: human review gate

**入力**: audit.json + profile.reviewPolicy

**処理**:
- `profile.reviewPolicy.mustReviewWarnings` に該当する warning が残っていれば「変換完了」扱いにしない
- `profile.reviewPolicy.minimumCoverage` のいずれかを下回れば停止
- 上記が満たされれば draft-state policy (`docs/spec/draft-state-policy.md`) の warning として残置、保存自体は許可

**判断**: 完全自動完了ではなく、人間 (または designer に承認された AI) が gate を通すモデル。

### Step 10: profile feedback loop

**目的**: AI の初回解釈を profile に還元し、次回以降は静的ルールとして再利用 (再実行決定性の核)

**処理**:
1. AI が新パターン (未登録 heading / 新 archetype / 新 binding pattern) を解釈
2. 解釈結果を profile の該当セクションに追記 (例: `headingAliases.controlMapping` に新別名追加)
3. 追記後の profile を `import-project-profile.json` に commit
4. 次回 import 時は Step 2/3 が AI 不在で同じ結果になる

---

## 3. Profile 適用ポイント一覧

| profile セクション | 適用ステップ |
|---|---|
| `sourceInventory` | Step 1 |
| `fileNaming.{codeExtractionPatterns, archetypeHints}` | Step 1, 2 |
| `headingAliases` | Step 3 |
| `tableHeaderAliases` | Step 3 |
| `archetypeRules` | Step 2 (heading 経由) |
| `businessVocabulary.{terms, synonyms}` | Step 4 (用語正規化) |
| `catalogRules.prioritySources` | Step 4 (catalog 優先解決) |
| `bindingRules.{attributeKinds, hiddenMarkers, loopBindingMarkers, outputBindingMarkers}` | Step 4 (screen-item binding) |
| `uiBehaviorPatterns.{knownPatterns, sharedScriptFiles}` | Step 5 (ui-behavior 退避) |
| `processFlowRules.{sharedCallMarkers, dbMarkers, throwMarkers, messageSettingMarkers}` | Step 4 (processFlow step kind 判定) |
| `reusableContracts.{promoteKinds, dataContractKinds}` | Step 5 (data-contract 昇格判定) |
| `exceptionSemantics.{classificationRules, defaultHandling}` | Step 5 (exception-type 分類) |
| `outputPolicy.{generateEntities, warningThresholds, allowDraftWithWarnings}` | Step 6, 8 |
| `reviewPolicy.{mustReviewWarnings, minimumCoverage}` | Step 9 |

---

## 4. 実装方針 (将来)

本手順書は仕様確定段階。実装は別 ISSUE で段階的に:

1. **Project profile loader** — `import-project-profile.json` の読み込み + AJV validation
2. **Inventory builder** — Step 1 (TS script、決定性確保)
3. **Archetype classifier** — Step 2 (regex + heading 一致、profile 駆動)
4. **Normalizer** — Step 3
5. **Entity mapper** — Step 4 (既存 entity への変換、AI フォールバック付き)
6. **Generic definition writer** — Step 5
7. **Auditor** — Step 6, 8 (warning + summary)
8. **Review gate** — Step 9
9. **Profile feedback CLI** — Step 10 (AI 解釈を半自動で profile に追記)

各ステップは TypeScript script (`scripts/import/<step>.ts`) を基本に、AI 解釈が必要な部分のみ MCP tool 呼び出しを挟む構造を想定。

---

## 5. 既存仕様との関係

| 既存 spec | 関係 |
|---|---|
| [`generic-definition-layer.md`](generic-definition-layer.md) | Layer 3 の元仕様 |
| [`draft-state-policy.md`](draft-state-policy.md) | Step 6, 8, 9 の warning / error 判定は draft-state policy の severity 基準に従う |
| [`schema-governance.md`](schema-governance.md) | Step 4 で新 schema が必要と判断された場合、勝手に拡張せず ISSUE 起票 (governance §「テスト pass を理由に schema を勝手に拡張するのは絶対禁止」) |
| [`sample-project-structure.md`](sample-project-structure.md) | `examples/<project-id>/import-project-profile.json` の配置先規約 |
| [`workspace.md`](workspace.md) | active workspace の `import-project-profile.json` を実行時に解決 |

---

## 6. Open Questions

1. **AI 呼び出し境界** — どのステップで AI を呼ぶか (Step 2/4/5 が候補)、どれを純 TS 決定性にするか
2. **MCP tool 化** — `designer__import_run` のような single-shot tool にするか、step ごとに細粒度 tool にするか
3. **profile schema バージョニング** — `profileVersion: "v1"` の互換戦略
4. **既存 importer 実装の有無** — 現状の `backend/src/mcp/` 等に類似機能があれば統合方針を整理 (未調査)
5. **CLI vs MCP** — Harmony 本体に組み込むか、別 CLI (`harmony-import`) として独立させるか
