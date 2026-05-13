# 汎用設計定義レイヤー (Generic Definition Layer)

**Status**: 🟡 **draft v0.1 (RFC)** — schema 即時固定化を伴わない整理段階
**起票 ISSUE**: #1060
**関連 memory**: `project_framework_research_2026_04_25.md` (拡張仕様 19 項目との突合)
**起票日**: 2026-05-13

---

## 1. 背景と目的

既存 Markdown 設計書を Harmony JSON に取り込むドッグフードで、現行 schema (`screen` / `processFlow` / `screenTransition` / `table` / `viewDefinition`) では受けきれない設計情報があることが判明した。

**取り込めなかったもの (実例)**:

- 例外体系、親子関係、例外ごとの責務
- DTO / Result / Utility / Validator / Formatter / Advice などの汎用クラス定義
- セキュリティ設定、ログ設定、AOP、共通ミドルウェア相当のアプリケーション設定
- 共通 UI 振る舞い、画面横断 JavaScript、入力連動ルール
- 画面 / Service / Mapper / Model / DTO / JS / CSS / Template の責務分割を示す構成情報

これらを「Markdown 原文に残しておく」「説明文に埋め込む」「AI コード生成時に毎回推論させる」のいずれかで凌いでいたが、設計書としての追跡可能性と再現性が弱い。

本仕様は、これらを **言語非依存** で受ける「汎用設計定義レイヤー」を導入するための整理。

### 非ゴール (本ドラフトで決めないこと)

- 各言語 (Java / TypeScript / Python) の具体クラス形・継承構文・アノテーションの再現
- schema の即時固定化 (まずメタモデルと境界を整理する)
- 既存 entity の破壊的変更 (拡張は加えるが旧 field の意味は維持)

---

## 2. 全体構成

提案は 3 層に分かれる。レイヤー間で責務を分けることで、新規 schema 量を最小化する。

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: 既存 entity の構造化拡張                                │
│   screen / screenItem / processFlow / table / screenTransition  │
│   → 自然に属するものは既存 entity 側に「構造化フィールド」を追加 │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: Generic Definition Catalog (新規)                       │
│   既存 entity に自然に属さないものを汎用メタモデルで受ける       │
│   8 kind: data-contract / domain-type / exception-type / ...    │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: Importer 手順書 + Project Profile (新規)                │
│   Markdown → Harmony JSON 変換の責務分担を機械可読化              │
│   Harmony 側 = 共通手順書 / Project 側 = profile / AI = 初回解釈 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Layer 1 — 既存 entity の構造化拡張

「既存 entity で済むものは無理に新 entity 化しない」原則 (本 ISSUE 設計指針 §4) に従い、まず既存側で吸収する。

### 3.1 ScreenItem の binding metadata 構造化

**現状の不足**: binding 情報を `description` に `attribute=... / mapping=... / source=...` の自由記述で埋め込みやすい。codegen の正式入力として弱い。

**追加候補フィールド (構造化案)**:

| フィールド | 値域 (案) | 役割 |
|---|---|---|
| `binding.kind` | `formField` / `viewModel` / `catalog` / `expression` / `fragmentParam` / `session` / `routeParam` / `queryParam` | 入出力種別の正式分類 |
| `binding.path` | string (式または plain path) | bind 対象 |
| `binding.optionSource` | catalog ref | options 出所 |
| `binding.formatHint` | string | 表示整形 hint |
| `binding.parseHint` | string | 入力 parse hint |
| `binding.role` | `display` / `input` / `both` | 表示専用か入力か |
| `binding.sourceNote` | string | 元文書上の出典メモ |

**判断**: ScreenItem 側に `binding` サブオブジェクトを追加。`description` 埋め込みからの移行は draft-state policy (`docs/spec/draft-state-policy.md`) の warning で誘導。

### 3.2 ScreenItemEvent の UI 効果 (UI effects) formal 化

**現状の不足**: event は `handlerFlowId` (=処理起動) に偏っていて、画面側の純粋な UI 効果が弱い。設計書に頻出するのは:

- 値クリア / readonly 切替 / enabled 切替 / visible 切替
- options 差し替え
- dialog 表示 / message area 更新
- リスト再描画
- Ajax 結果に応じた複数項目更新

**追加候補**: `event.effects[]` を導入。各 effect は `{ kind, target, value? }` 形式。

| effect kind (案) | target | value |
|---|---|---|
| `clear` | itemId | — |
| `setReadonly` / `setEnabled` / `setVisible` | itemId | boolean / expression |
| `setOptions` | itemId | catalogRef / expression |
| `showDialog` | dialogRef | messageRef / expression |
| `setMessage` | messageAreaRef | messageRef / expression |
| `refreshList` | listItemId | — |
| `applyAjaxResult` | mapping[] | response path → itemId |

**判断**: `event` 配下に `effects[]` を追加。既存 `handlerFlowId` は維持し、effect の一種扱いにはしない (UI ローカル効果と処理起動は概念分離)。

### 3.3 ProcessFlow の internal reusable call 抽象

**現状の不足**: DB / external / AI / TX などの step kind はあるが、「内部共通処理」「共有コンポーネント」「ドメインサービス呼び出し」を first-class に参照する抽象が弱い。

**追加候補**: step kind に `componentCall` を追加し、Generic Definition Catalog の `component-definition` を参照する。

```json
{
  "kind": "componentCall",
  "componentRef": "validators/customer-input-validator",
  "inputs": { ... },
  "outputs": { ... }
}
```

**判断**: schema 追加が必要。既存の `compute` step + 説明文への退避をやめ、共有ロジックの責務分割を formal にする。

### 3.4 ProcessFlow の error semantics 拡張

**現状の不足**: `errorCode` catalog や response はあるが、設計書では以下も必要:

- 失敗種別 (business-abort / validation-error / authentication-error / system-error)
- recoverable / non-recoverable
- 中断 / 継続 / 再試行可否
- 上位へ返す意味
- 既定ハンドリングポリシー
- UI message 変換方針

**追加候補**: Generic Definition Catalog の `exception-type` を導入し、`errorCode` 側から `exceptionTypeRef` で参照する。

**判断**: 階層 (parent / children) と semantic kind は Catalog 側に置き、ProcessFlow からは ref のみ。

### 3.5 再利用 named contract の参照導線

**現状の不足**: Action の `inputs` / `outputs` / `responses.bodySchema` は inline 構造で書く前提で、複数 step や複数 ProcessFlow で同じ DTO を共有する仕組みが弱い。

**追加候補**: Generic Definition Catalog の `data-contract` を導入し、`inputs.$ref` / `outputs.$ref` / `responses.bodySchemaRef` で参照する。

**判断**: 既存 inline 形式は維持 (移行を強制しない)。`$ref` を opt-in で許容するのが最小変更。

### 3.6 再利用 UI fragment / common component の参照

**現状の不足**: 共通ヘッダー、共通メッセージ領域、アップロード行など、再利用 UI 断片を formal に保持しにくい。

**追加候補**: Generic Definition Catalog の `ui-fragment` を導入し、`screen.fragments[].fragmentRef` で参照する。

**判断**: PageLayout (#1021 シリーズ、進行中) との関係整理が必要。PageLayout = ページ単位の全体構造、UI fragment = ページ内/画面横断の再利用部品、と切り分ける。

---

## 4. Layer 2 — Generic Definition Catalog

既存 entity に自然に属さない設計情報を受ける、新規メタモデル。

### 4.1 共通メタモデル

```json
{
  "$id": "generic-definitions/<kind>/<name>",
  "kind": "data-contract" | "domain-type" | "exception-type"
        | "application-rule" | "ui-behavior" | "runtime-policy"
        | "component-definition" | "ui-fragment",
  "name": "string",
  "purpose": "string (1-2 行)",
  "responsibilities": ["..."],
  "fields": [ { "name": "...", "type": "...", "constraints": [...] } ],
  "operations": [ { "name": "...", "inputs": [...], "outputs": [...] } ],
  "relations": [ { "kind": "extends|implements|uses|transformsFrom|transformsTo|appliesTo", "ref": "..." } ],
  "constraints": ["不変条件・事前/事後条件"],
  "mappingHints": {
    "backend.spring": { ... },
    "backend.nestjs": { ... },
    "frontend.next": { ... }
  },
  "targets": ["backend" | "frontend" | "shared" | "runtime"]
}
```

### 4.2 8 種類の kind

| kind | 用途 | 主な参照元 |
|---|---|---|
| `data-contract` | DTO / Form / Result / ViewModel など、層間契約 | ScreenItem / ProcessFlow.inputs/outputs |
| `domain-type` | Entity / Model などドメイン型 (永続化を含む) | table 補完 / ProcessFlow |
| `exception-type` | 例外種別・階層・semantic kind | errorCode catalog |
| `application-rule` | 認証認可ポリシー / ログ / 監査 / 例外変換 / 横断ルール | project-level config |
| `ui-behavior` | 画面横断振る舞い (dirty check / dialog / datepicker / 二重送信防止) | ScreenItem.event.effects[] / screen.commonBehaviors[] |
| `runtime-policy` | retry / timeout / circuit breaker / cache (横断適用ポリシー) | ProcessFlow step / external system |
| `component-definition` | service / mapper / repository / validator / formatter / facade / adapter / helper 等の責務 | ProcessFlow.componentCall |
| `ui-fragment` | 再利用 UI 断片 (ヘッダー / フッター / メッセージ領域等) | screen.fragments[] |

### 4.3 既存仕様との関係

| 既存 spec | 関係 |
|---|---|
| `docs/spec/process-flow-extensions.md` | extensions namespace を catalog 種別の格納先として使う検討余地あり |
| `docs/spec/page-layout.md` | `ui-fragment` と PageLayout は分離 (§3.6 参照) |
| `docs/spec/process-flow-sla.md` | SLA / Timeout 宣言は `runtime-policy` の subset として位置付け可能 |
| `docs/spec/process-flow-tier-c.md` | circuitBreaker / bulkhead / health / readiness も `runtime-policy` 系 |
| `docs/spec/process-flow-workflow.md` | WorkflowPattern は `component-definition` ではなく既存 first-class 維持 |

### 4.4 schema governance との関係

本 layer の schema 追加は **`docs/spec/schema-governance.md`** の対象 (= 設計者承認必須)。本ドラフトは整理段階であり、schema 切り出しは別 ISSUE で段階的に実施する。

---

## 5. Layer 3 — Importer 手順書 + Project Profile

Markdown → Harmony JSON 変換の責務分担を機械可読化する。

### 5.1 責務分担

| 担当 | 持ち物 |
|---|---|
| **Harmony 側** | 共通 importer 手順書 / 共通 audit ルール / 共通 schema / generic definition 方針 |
| **Project 側** | `import-project-profile.json` (project ごとに 1 つ) |
| **AI** | 初回の未知パターン解釈 + その結果の profile への還元 |

### 5.2 共通 importer 標準フロー (10 ステップ)

1. **文書 inventory** — Markdown 全件列挙 / file name, archetype 候補, code, mtime を中間成果物に保存 / 原文不変
2. **archetype 分類** — controller / service / architecture / reference / configuration / common-js / exception / class-definition / catalog
3. **heading / table 正規化** — 別名・表ヘッダの揺れ・番号付き見出しを統一 (profile の `headingAliases` で上書き可)
4. **entity mapping** — 自然に落ちるものを既存 entity に変換 (screen / processFlow / table / viewDefinition / screenTransition / conventions)
5. **generic definition 退避** — 既存 entity に属さないものを Layer 2 に変換
6. **warning / audit 出力** — file / section / reason / suggested target entity を human + machine readable に
7. **deterministic 再実行** — 同じ MD + 同じ profile なら同じ JSON
8. **schema validation** — AJV + audit summary (未変換 archetype / warning 数 / coverage)
9. **human review gate** — warning しきい値超過時は変換完了扱いにしない
10. **profile feedback loop** — AI の初回解釈を profile に還元、次回以降は静的ルール化

### 5.3 Project Profile schema (v0.1 雛形)

ISSUE #1060 Comment 2 で提示された canonical JSON 雛形 (省略形):

```jsonc
{
  "$schema": "./schemas/import-project-profile.v1.schema.json",
  "profileVersion": "v1",
  "name": "<project>",
  "sourceInventory": { "rootDirs": [...], "includeGlobs": [...], "excludeGlobs": [...], "priorityDocuments": [...] },
  "fileNaming": { "codeExtractionPatterns": [...], "archetypeHints": [...] },
  "headingAliases": { "controlMapping": [...], "formProperties": [...], "processOverview": [...], "transitionTargets": [...] },
  "tableHeaderAliases": { "controlMapping": [...], "methodTable": [...], "basicInfo": [...] },
  "archetypeRules": [...],
  "businessVocabulary": { "terms": {...}, "synonyms": {...} },
  "catalogRules": { "prioritySources": {...}, "optionResolution": {...} },
  "bindingRules": { "attributeKinds": {...}, "hiddenMarkers": [...], "loopBindingMarkers": [...], "outputBindingMarkers": [...] },
  "uiBehaviorPatterns": { "knownPatterns": [...], "sharedScriptFiles": [...] },
  "processFlowRules": { "sharedCallMarkers": [...], "dbMarkers": [...], "throwMarkers": [...], "messageSettingMarkers": [...] },
  "reusableContracts": { "promoteKinds": [...], "dataContractKinds": {...} },
  "exceptionSemantics": { "classificationRules": [...], "defaultHandling": {...} },
  "outputPolicy": { "generateEntities": [...], "warningThresholds": {...}, "allowDraftWithWarnings": true },
  "reviewPolicy": { "mustReviewWarnings": [...], "minimumCoverage": {...} }
}
```

(完全な雛形は #1060 Comment 2 を参照。本仕様確定時に正規 schema へ変換)

### 5.4 配置先

- 共通 importer 手順書 → `docs/spec/import-procedure.md` (本ドラフトとは別 spec、後続)
- Project profile schema → `schemas/import-project-profile.v1.schema.json` (新規)
- 各 project の profile → `examples/<project-id>/import-project-profile.json` or `workspaces/<wsId>/import-project-profile.json`

---

## 6. 設計指針 (本 ISSUE §設計指針 を統合)

1. **具体クラス定義の再現を目的にしない** — 言語非依存の設計意味を保持する
2. **例外は「クラス本体」より「意味と契約」を優先する** — semantic kind / recoverable / handling 方針が中核
3. **DTO / Result / Utility も「責務」が本体** — 名前そのものではなく purpose / responsibilities が一次情報
4. **既存 entity で済むものは無理に新 entity 化しない** — Layer 1 で吸収、Layer 2 は最後手段
5. **AI 補完を前提にしてよいが、境界は明示する** — 設計書で保持: 意味/責務/契約/制約/UI 振る舞い、AI に委ねる: 具体クラス形/フレームワーク記法
6. **専用 schema 追加の前に generic definition を親概念にする** — `exceptionCatalog` / `classCatalog` を細かく切るより、上位の generic definition + profile / view で対応

---

## 7. 既存 framework research との突合

`project_framework_research_2026_04_25.md` (memory) の追加仕様 19 項目との overlap を整理:

| #1060 提案 | framework-research 19 項目 | 統合方針 |
|---|---|---|
| `application-rule` (認証認可 / ログ / 監査 / 例外変換) | #1 ログ/監査ステップ, #2 RBAC | 一部重複 — `application-rule` は横断ポリシー、ProcessFlow `LogStep`/`AuditStep` は flow 内の個別行為。両立可 |
| `exception-type` Catalog | (なし) | **新規**。framework-research に欠けていた領域 |
| `runtime-policy` (retry / timeout / circuit breaker / cache) | #5 SLA/Timeout, #13 Circuit Breaker/Bulkhead | **既に spec 化済** (`process-flow-sla.md` / `process-flow-tier-c.md`) — 横断適用ポリシーの kind を catalog に追加する形で吸収 |
| `data-contract` (DTO / Form / Result / ViewModel) | (なし、Domain は近い) | **新規**。GeneXus の Domain は型+制約だが、本提案の data-contract は契約 (層間 IO) を含む |
| `domain-type` | Priority 2-#4 Domain 概念 (GeneXus) | **重複** — 統合して 1 つの Catalog kind とする |
| `ui-behavior` Catalog | (なし) | **新規**。設計書に頻出する dirty check / dialog / datepicker 等の formal 化 |
| `ui-fragment` | (なし、PageLayout は別) | **新規**。PageLayout (#1021) と切り分け |
| `component-definition` | (なし) | **新規**。共有 service / mapper / validator の責務分離 |
| ScreenItem binding 構造化 | Tier D-#18 ScreenItem 派生値 (Formula) | 別観点 — binding 構造化と Formula は併存可 |
| ScreenItemEvent UI effects | (なし) | **新規** |
| Importer 手順書 + Project Profile | (なし) | **新規**。framework-research は schema 拡張側、本提案は取り込み runtime 側 |

**統合判断**: framework-research 19 項目と #1060 提案は **大半が直交**。重複は `domain-type` ↔ Priority 2-#4 Domain の 1 件のみで、これは 1 つの catalog kind に統合する。

---

## 8. 実装優先度 (本 ISSUE 原文に準拠)

### P0 (最優先)

- ScreenItem binding metadata 構造化 (Layer 1, §3.1)
- ScreenItemEvent UI effects formal 化 (Layer 1, §3.2)
- `data-contract` / `domain-type` catalog (Layer 2)
- Generic Definition Layer の親 schema (Layer 2 §4.1 共通メタモデル)

### P1

- ProcessFlow `componentCall` step + `component-definition` (Layer 1 §3.3 + Layer 2)
- `exception-type` catalog + ProcessFlow error semantics 拡張 (Layer 1 §3.4 + Layer 2)
- `ui-fragment` catalog + screen.fragments 参照 (Layer 1 §3.6 + Layer 2)

### P2

- `application-rule` / `runtime-policy` / `ui-behavior` catalog 完全実装 (Layer 2)
- techStack 別 codegen profile (mappingHints の実装側展開)
- Importer 手順書 + Project profile (Layer 3)

---

## 9. 期待する成果

- 設計書として保持すべき情報と、AI に委ねる実装詳細を **設計レベルで分離** できる
- 実装言語が Java / TypeScript / Python でも共通の設計資産として再利用可能
- AI コード生成時に、Markdown 原文依存を減らし Harmony JSON から一貫生成しやすくなる
- 既存 JSON の説明文埋め込みを減らし、機械利用性を上げる
- 将来的に専用 schema (exception-only / class-only など) を増やす場合も、本 layer を親概念として据えられる

---

## 10. 受け入れ条件 (本 ISSUE §受け入れ条件)

- ☐ 既存の `screen` / `processFlow` / `table` / `viewDefinition` で表現しづらい設計情報を分類できること
- ☐ 画面 binding / UI behavior / reusable contract / exception semantics の少なくとも 4 領域で、現行の欠落点と拡張方針を定義できること (§3 / §4)
- ☐ 例外定義 / 汎用クラス定義 / アプリケーション設定 / UI 振る舞いの少なくとも 4 類型を Generic Definition Catalog 上で表現できること (§4.2)
- ☐ 実装言語固有の構文に閉じないこと (§6 設計指針 §1, §6)
- ☐ 「必須設計情報」と「AI 補完可の実装詳細」の境界をガイドとして定義すること (§6 設計指針 §5)

---

## 11. Open Questions (未確定事項)

1. **`extensions/` との関係** — 本 layer の catalog を既存 `extensions/<namespace>/*.json` 機構に載せるか、新規 `generic-definitions/` ディレクトリを切るか
2. **PageLayout (#1021) と `ui-fragment` の境界** — Page-level vs Fragment-level の正確な切り分け基準
3. **既存 `process-flow-extensions.md` との統合** — extensions namespace を catalog 種別格納先として共用可能か
4. **schema 切り出しの順序** — どの catalog kind から AJV / TypeScript 型に落とすか
5. **Importer 手順書を独立 spec にするか本 spec 内に残すか** — Layer 3 は別 ISSUE で分離する可能性
6. **`mappingHints` の標準形** — techStack 別の codegen ヒントをどう正規化するか (`/generate-code` skill との連携)

---

## 12. 後続作業

本ドラフト承認後に着手する子作業 (まだ ISSUE 化しない、本ドラフトの議論で確定後に分割起票):

1. Open Questions の解消 (本 ISSUE のコメントで議論)
2. P0 ごとの schema 切り出し設計 (`schemas/v3/screen-item.schema.json` 拡張、`schemas/generic-definitions/*.schema.json` 新設)
3. Importer 手順書の独立 spec 化 (`docs/spec/import-procedure.md`)
4. Project profile schema 設計 (`schemas/import-project-profile.v1.schema.json`)
5. validator / AJV 統合 (`process-flow-maturity.md` の draft-state policy 準拠)
6. UI 側の表示・編集対応 (新規 catalog 種別ごとの ListView / Editor 検討)

各作業は schema governance に基づき、本ドラフト確定 → 設計者承認 → 個別 ISSUE 起票 の順で進める。
