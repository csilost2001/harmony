# 汎用設計定義レイヤー (Generic Definition Layer)

**Status**: 🟡 **draft v0.2 (RFC)** — schema 即時固定化を伴わない整理段階 / Q1-Q11 決定反映 (2026-05-13)
**起票 ISSUE**: #1060
**関連 memory**: `project_framework_research_2026_04_25.md` (拡張仕様 19 項目との突合)
**起票日**: 2026-05-13
**変換ガイドライン**: [`conversion-guideline-for-ai.md`](conversion-guideline-for-ai.md) — Markdown → Harmony JSON 変換の AI 向けマニュアル
**スキル起点**: [`.claude/skills/import-md/SKILL.md`](../../.claude/skills/import-md/SKILL.md)

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
│   配置: examples/<project>/<dataDir>/generic-definitions/<kind>/*.json    │
├─────────────────────────────────────────────────────────────────┤
│ Layer 3: AI 向け変換マニュアル + 生成 importer (新規)             │
│   Harmony 側 = AI 向けマニュアル (entity 構造 / 落とし方 / audit /│
│                 TS scaffold / 既知落とし穴) → conversion-        │
│                 guideline-for-ai.md                              │
│   Project 側  = MD (構造は project 自由) + (option) profile     │
│   AI         = マニュアル参照しつつ 1 回限り変換 or importer 生成│
└─────────────────────────────────────────────────────────────────┘
```

### 配置決定 (Q1-Q3 確定)

- **Generic Definition Catalog**: 独立ディレクトリ `examples/<project>/<dataDir>/generic-definitions/<kind>/*.json` を切る (Q1)。`extensions/` 機構には載せない (extensions = opt-in 拡張 / generic-definitions = project 全体の再利用資産、性格が異なる)
- **`ui-fragment` と PageLayout (#1021)**: page-level vs component-level で切る (Q2)。PageLayout = ページ全体の骨格 (header / sidebar / content slot / footer)、`ui-fragment` = ページ内 or 複数画面で使い回す部品 (メッセージ領域 / アップロード行 / ダイアログ本体)
- **`process-flow-extensions.md` と Generic Definition Catalog**: 両者独立、ProcessFlow から `$ref` で generic-definitions を参照 (Q3)。process-flow-extensions = ProcessFlow 内側の step 拡張型、generic-definitions = project 全体の再利用資産

---

## 3. Layer 1 — 既存 entity の構造化拡張

「既存 entity で済むものは無理に新 entity 化しない」原則 (本 spec §6 設計指針 4 = ISSUE #1060 本文「設計指針 §4」) に従い、まず既存側で吸収する。

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

**判断 (Q2 確定)**: PageLayout (#1021) と `ui-fragment` は **page-level vs component-level で切る**:
- **PageLayout**: ページ全体の骨格 (header slot / sidebar slot / content slot / footer slot)。1 page = 1 PageLayout 適用
- **`ui-fragment`**: ページ内 or 複数画面で使い回す部品 (メッセージ領域 / アップロード行 / ダイアログ本体 / 共通ヘッダー部品)。PageLayout の slot を埋める要素にもなり得る

具体例:
```
PageLayout "admin-layout"  ←  ページ全体の枠
  ├─ header slot   ←  ui-fragment "common-header" を埋める
  ├─ sidebar slot  ←  ui-fragment "admin-nav" を埋める
  ├─ content slot  ←  screen が入る
  │                   screen は内部に ui-fragment "message-area" / "upload-row" 等を持つ
  └─ footer slot   ←  ui-fragment "common-footer" を埋める
```

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

**設計指針: 言語非依存の本体 vs `mappingHints` の位置付け**:

- **言語非依存の本体** (必須): `kind` / `name` / `purpose` / `responsibilities` / `fields` / `relations` / `constraints` / `targets`。設計書として保持すべき意味・責務・契約・制約を表現する
- **`mappingHints` は完全 optional / advisory** (任意): 特定 techStack (Spring / Nest / Next 等) への codegen 時のヒント。設計書の本質ではなく **AI 生成側のチューニング材料**。本 spec の Spring/Nest/Next 例はあくまでサンプルで、Django / Rails / Vue 等への展開も自由
- `mappingHints` が無くても **言語非依存の本体だけで設計意図は完結する** こと。逆に `mappingHints` だけで設計意図を表現するのは禁止 (本体に migrate する)

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

## 5. Layer 3 — AI 向け変換マニュアル + 生成 importer

**方針 (Q7-Q11 決定)**: Harmony 側に固定 importer ツールは持たない。MD は project 構造がバラバラなので、**AI 向けマニュアル** を一次成果物として整備し、AI がそれを読みつつ (a) 1 回限り変換 or (b) project 専用 importer 生成 のいずれかで対応する。

### 5.1 責務分担

| 担当 | 持ち物 |
|---|---|
| **Harmony 側** | AI 向け変換マニュアル ([`conversion-guideline-for-ai.md`](conversion-guideline-for-ai.md)) / catalog 8 kind の共通メタモデル / audit / warning 規範 / TS scaffold テンプレ / 既知落とし穴集約 / (option) project profile JSON 推奨フォーマット |
| **Project 側** | 自由形式の Markdown 設計書 + (optional) `import-project-profile.json` |
| **AI** | マニュアル参照しつつ 1 回限り変換 or `scripts/import/*.ts` 生成 |

### 5.2 提供形態 (Q10 決定)

`docs/spec/` + `.claude/skills/` の両方:

- **[`docs/spec/conversion-guideline-for-ai.md`](conversion-guideline-for-ai.md)** — 一次ソース。人間と AI 両方が読む詳細マニュアル
- **[`.claude/skills/import-md/SKILL.md`](../../.claude/skills/import-md/SKILL.md)** — 起動点 (`/import-md <project>` で発火 or auto-trigger キーワード "Markdown 設計書" "Harmony JSON 変換")。中身は spec への誘導

### 5.3 マニュアルに含める要素 (Q9 = 全部入り)

[`conversion-guideline-for-ai.md`](conversion-guideline-for-ai.md) に集約:

1. **§1 出力先 Harmony JSON の全体構造** — 既存 entity 一覧 + Generic Definition Catalog 8 kind の配置
2. **§2 入力 MD の archetype 10 種類** — 判定アルゴリズム (file name → 見出し → 表ヘッダ)
3. **§3 archetype 別 落とし方ガイド** — before/after pair を 7 archetype 分掲載
4. **§4 Generic Definition Catalog の共通メタモデル**
5. **§5 audit / warning 規範** — 12 種の warning kind + audit summary 形式
6. **§6 パターン (A) 1 回限り変換 の進め方** — 10 step フロー
7. **§7 パターン (B) Importer 生成 の進め方** — TS scaffold + Step 別 純TS/AI 補完区分
8. **§8 既知落とし穴 (memory 集約)** — ProcessFlow / ScreenItem / SQL / silent pass 等
9. **§9 Decision flowchart** — (A) vs (B) 判定
10. **§10 変換完了判定基準**
11. **§11 関連 spec / memory リンク**

### 5.4 Project Profile schema (optional)

profile は **optional** (project が継続変換するなら使う、1 回限りなら不要)。

- 推奨 schema: [`schemas/import-project-profile.v1.schema.json`](../../schemas/import-project-profile.v1.schema.json)
- サンプル: [`examples/retail/import-project-profile.json`](../../examples/retail/import-project-profile.json)
- 14 セクション構造の詳細は [`conversion-guideline-for-ai.md` §7.3](conversion-guideline-for-ai.md)

profile を使うと §7.1 の各 step に project 固有ルールを注入できる。profile を使わない場合、AI が毎回マニュアルを参照しつつ判断する。

### 5.5 importer 生成の物理配置

AI が生成する project 専用 importer は `<project>/scripts/import/*.ts` に配置。詳細スキャフォールドは [`conversion-guideline-for-ai.md` §7.2](conversion-guideline-for-ai.md)。

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

## 8. 実装優先度 (Q4 確定: 親 schema 優先 / 依存順)

P0 内部の切り出し順序は **下層が上層に依存しない依存順** (Q4 決定):

### P0 (最優先、依存順)

1. **Generic Definition 親 schema** (Layer 2 §4.1) — kind / name / fields / relations / mappingHints の共通メタモデル
2. **`data-contract` / `domain-type` catalog** (Layer 2) — 親 schema を継承
3. **ScreenItem binding 拡張** (Layer 1 §3.1) — `data-contract` への `$ref` を使う
4. **ScreenItemEvent UI effects** (Layer 1 §3.2) — UI ローカル効果の formal 化

各ステップは下位の schema が確定してから上位を切り出すことで、後戻りを防ぐ。

### P1

5. ProcessFlow `componentCall` step + `component-definition` (Layer 1 §3.3 + Layer 2)
6. `exception-type` catalog + ProcessFlow error semantics 拡張 (Layer 1 §3.4 + Layer 2)
7. `ui-fragment` catalog + `screen.fragments` 参照 (Layer 1 §3.6 + Layer 2)

### P2

8. `application-rule` / `runtime-policy` / `ui-behavior` catalog 完全実装 (Layer 2)
9. `mappingHints` (free-form object, Q6 確定) と各 techStack codegen 連携 (`/generate-code` skill 拡張)
10. AI 向け変換マニュアル ([`conversion-guideline-for-ai.md`](conversion-guideline-for-ai.md)) の継続更新 (新 archetype / 新 warning / 新落とし穴の追加)

---

## 9. 期待する成果

- 設計書として保持すべき情報と、AI に委ねる実装詳細を **設計レベルで分離** できる
- 実装言語が Java / TypeScript / Python でも共通の設計資産として再利用可能
- AI コード生成時に、Markdown 原文依存を減らし Harmony JSON から一貫生成しやすくなる
- 既存 JSON の説明文埋め込みを減らし、機械利用性を上げる
- 将来的に専用 schema (exception-only / class-only など) を増やす場合も、本 layer を親概念として据えられる

---

## 10. 受け入れ条件 (本 ISSUE §受け入れ条件)

- ☑ 既存の `screen` / `processFlow` / `table` / `viewDefinition` で表現しづらい設計情報を分類できること
- ☑ 画面 binding / UI behavior / reusable contract / exception semantics の少なくとも 4 領域で、現行の欠落点と拡張方針を定義できること (§3 / §4)
- ☑ 例外定義 / 汎用クラス定義 / アプリケーション設定 / UI 振る舞いの少なくとも 4 類型を Generic Definition Catalog 上で表現できること (§4.2)
- ☑ 実装言語固有の構文に閉じないこと (§6 設計指針 §1, §6)
- ☑ 「必須設計情報」と「AI 補完可の実装詳細」の境界をガイドとして定義すること (§6 設計指針 §5)

---

## 11. 解消済 Open Questions (Q1-Q11 ISSUE #1060 discussion 2026-05-13)

| # | 論点 | 決定 |
|---|---|---|
| Q1 | catalog 配置 | 独立ディレクトリ `examples/<project>/<dataDir>/generic-definitions/<kind>/*.json` を切る |
| Q2 | PageLayout vs ui-fragment 境界 | Page-level vs Component-level で切る (PageLayout = 骨格、ui-fragment = 部品) |
| Q3 | process-flow-extensions との統合 | 両者独立、ProcessFlow から `$ref` で generic-definitions を参照 |
| Q4 | P0 schema 切り出し順序 | 親 schema → data-contract/domain-type → ScreenItem binding → Event UI effects |
| Q5 | import-procedure.md 独立性 | conversion-guideline-for-ai.md (AI 向けマニュアル) に統合、独立 spec 廃止 |
| Q6 | mappingHints 標準形 | free-form object (techStack 別キー、中身は AI 解釈) |
| Q7-Q8 | Importer 必要性 / Layer 3 形態 | AI 向けマニュアル型に転換。Harmony 側に固定 importer 持たず、AI がマニュアル参照しつつ 1 回限り変換 or project 専用 importer 生成 |
| Q9 | マニュアルに含める要素 | 全部入り (entity 構造 / archetype ガイド / audit / TS scaffold / profile テンプレ / 既知落とし穴 / decision flowchart) |
| Q10 | マニュアル配置 | `docs/spec/conversion-guideline-for-ai.md` + `.claude/skills/import-md/SKILL.md` 両方 |
| Q11 | 既生成物 (import-procedure / RFC schema / sample profile) | マニュアルの中に再利用、profile schema と sample は optional フォーマットとして保持 |

---

## 12. 後続作業 (子 ISSUE 起票計画)

本ドラフト確定後、`#1060` を親メタ ISSUE として扱い、以下を **本 PR merge と同タイミングで一括起票** する。AGENTS.md 鉄則 0 (放置禁止) + 鉄則 1 (本 PR 吸収優先) を遵守するため、本 PR 内では「将来化」を許容しない:

| 順 | 作業 | 対応箇所 | 起票方針 |
|---|---|---|---|
| 1 | Generic Definition 親 schema 切り出し | `schemas/v3/generic-definition.v3.schema.json` (新設) | 単独 ISSUE (子 1)、本 PR merge と同時起票 |
| 2 | data-contract / domain-type catalog schema | `schemas/v3/generic-definitions/data-contract.v3.schema.json` 等 | 単独 ISSUE (子 2)、子 1 完了後着手 |
| 3 | ScreenItem `binding` 構造化拡張 | `schemas/v3/screen-item.v3.schema.json` 変更 | 単独 ISSUE (子 3)、子 2 完了後着手 |
| 4 | ScreenItemEvent `effects[]` 拡張 | 同 schema 変更 | 子 3 と統合 (同 schema / 同画面項目領域、鉄則 3 同根統合) |
| 5 | ProcessFlow `componentCall` step kind + component-definition + DB step `dbQuery/Insert/Update` 細分化検討 | `schemas/v3/process-flow.v3.schema.json` 変更 | 単独 ISSUE (子 4)、子 2 完了後着手 |
| 6 | exception-type catalog + ProcessFlow error semantics 拡張 | 同上 + catalog 新設 | 子 4 と統合 (同 schema / error 領域、鉄則 3) |
| 7 | ui-fragment catalog + `screen.fragments[]` | `schemas/v3/screen.v3.schema.json` 変更 + catalog 新設 | 単独 ISSUE (子 5)、子 2 完了後着手 |
| 8 | application-rule / runtime-policy / ui-behavior catalog | catalog 各 schema 新設 | 単独 ISSUE (子 6)、子 2 完了後着手 |
| 9 | UI 側の表示・編集対応 (新規 catalog 種別ごとの ListView / Editor) | frontend | 単独 ISSUE (子 7)、子 2-6 完了後着手 |
| 10 | conversion-guideline-for-ai.md 継続更新 (新 archetype / 新 warning / 新落とし穴) | docs | 本 PR では起票せず、運用継続タスクとして親 ISSUE #1060 にチェックリスト化 |

**統合後の子 ISSUE 数**: 7 件 (子 1-7) + 親メタ #1060 で運用継続項目 (#10) を管理。

**起票運用**:
- 本 PR merge 確認後 **24 時間以内** に親 ISSUE #1060 のコメントとして子 1-7 を起票し、各 ISSUE 番号を本表に back-fill する
- 「設計者承認待ち」「将来検討」のままで放置しない (鉄則 0)
- 個別 ISSUE 番号確定後、本 spec §12 を編集して `子 1 → #YYYY` のように記録

各作業の schema 変更は schema governance に従い、起票時点で設計者承認を取る。
