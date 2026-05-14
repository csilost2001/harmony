# draft-state policy (設計途中許容 + 警告可視化)

**改訂日: 2026-04-29**

Issue: #584
ステータス: **v1.0**

本仕様は、業務リソースを設計途中の状態で保存できるようにしつつ、未完成・不整合・schema 違反を UI 上で明示するための共通方針を定める。対象は View / Table / ProcessFlow を含む業務リソース全般であり、新しいリソース種別を追加する場合も本仕様に従う。

## 1. 目的

JSON Schema は **最終形の品質ゲート** として維持する。一方、UI は設計途中の draft-state を許容し、未完成箇所や違反箇所を保存ブロッカーではなく可視化対象として扱う。

この分離により、以下を実現する:

- View / Table / ProcessFlow で draft-state の扱いを統一する
- error / warning の判定基準をリソース間で揃える
- AJV が担う領域と手書きバリデータが担う領域を明確にする
- schema を緩めずに、設計途中の反復作業を止めない

## 2. 5 原則

### 2.1 schema は最終ゲート

`schemas/process-flow.schema.json` / `schemas/v3/table.v3.schema.json` / `schemas/v3/view.v3.schema.json` / `schemas/extensions-*.schema.json` / `schemas/conventions.schema.json` 等のグローバル定義 schema は、最終形の品質ゲートとして扱う。draft-state を保存したいという理由で schema を緩めてはならない。

schema 変更は schema ガバナンス (#511) の対象であり、AI エージェントが勝手に変更することは禁止する。表現不能な場合は `docs/spec/schema-governance.md` の手順に従い、拡張機構・既存フィールドで代替できないかを確認し、それでも無理なら ISSUE 起票して作業停止する。

### 2.2 保存は常に許可

業務リソースの保存処理は、schema 違反や未完成項目があってもブロックしない。保存はユーザーの作業途中状態を失わないための操作であり、完成判定とは分離する。

保存時に検出した違反は、保存失敗ではなく validation 結果として保持し、一覧・カード・編集画面で可視化する。

### 2.3 読み込み時に検証

各リソースは読み込み時に `validate<Resource>(item, allItems)` で検証する。単体項目だけで判定できない重複・参照整合性・リソース間関係は、必要な一覧を `allItems` として渡して判定する。

store は一覧読み込みと同じ責務範囲で `load<Resource>ValidationMap()` を提供する。戻り値は `Map<Id, ValidationError[]>` とし、UI はこれを参照してバッジ・枠線・ヘッダー警告を描画する。

### 2.4 違反は一覧と編集画面で示す

一覧画面では `ValidationBadge` を表示し、error / warning の件数をユーザーが俯瞰できるようにする。カード表示では `has-error` / `has-warning` CSS クラスを付与し、カード全体の状態として視認できるようにする。

編集画面では、画面ヘッダー・リソースヘッダー・該当セクションに validation 状態を表示する。ユーザーが「どのリソースが悪いか」だけでなく「どの領域を直せばよいか」を追えることを必須とする。

### 2.5 成熟度表示は必須

すべての業務リソース**実体** (instance) UI は `MaturityBadge` を表示する。GenericDefinition のような **kind-discriminated 定義カタログ** (≒ 参照語彙、永続化を伴わない設計定義) は本項の対象外とする (詳細は `generic-definition-layer.md` §4.5 参照)。成熟度未指定の既存データは `draft` として扱う。

一覧画面の `MaturityBadge` は view-only とし、編集画面の `MaturityBadge` は `onChange` を受け取って成熟度を変更できる。`committed` は「下流工程へ渡せる確定状態」を示すため、validation の可視化と併用する。

**commit 阻止 UI の責務分担 (#1004 Phase 4 で確定)**:
- error 件数 > 0 の場合に `committed` への遷移を阻止する確認ダイアログ等の UI は **Editor 側のみで実装**する。
- ListView の `MaturityBadge` は view-only (クリック・変更操作なし) のため、ListView 側に commit 阻止ロジックは実装しない。
- 現時点では Editor 側の commit 阻止も未実装 (将来の拡張候補)。実装が必要な場合は別 ISSUE で起票して対応する。

> **e2e spec との対応**: `frontend/e2e/draft-state-validation.spec.ts` の P3-block test (ListView での commit 阻止 UI) は上記判定により by design 恒久 skip とする (#1004 Phase 4 で確定)。

## 3. severity 判定基準

validation severity は次の 4 軸で判定する。迷った場合は、ユーザーが直ちに作業を継続できるかではなく、下流処理や識別子の整合性を壊すかで error / warning を分ける。

| 判定軸 | severity | 基準 |
|---|---|---|
| 動作可能性 | error | 実行・描画・解決に必要な最低限の情報が欠け、対象リソースを正しく扱えない |
| 物理同一性 | error | ID・name・重複・参照先など、同一性や参照整合性が壊れている |
| 表示完成度 | warning | 表示名・説明・見た目・補助情報など、利用品質は下がるが同一性や動作は壊れない |
| 業務妥当性 | warning | 業務上は未確認・不足・仮置きだが、構造としては保存・表示・編集できる |

View の代表例 (`frontend/src/utils/viewValidation.ts`):

- error: `selectStatement` 空、`physicalName` 空、`physicalName` が同一名前空間内で重複
- warning: `outputColumns` 空、`name` (表示名) 空

Table の代表例 (`frontend/src/utils/tableValidation.ts`):

- error: `physicalName` 空、`physicalName` が同一名前空間内で重複
- warning: `columns` 空、主キー (`primaryKey: true`) のカラムが 1 件もない、`name` (表示名) 空

ProcessFlow の代表例 (`frontend/src/utils/actionValidation.ts` + `aggregatedValidation.ts`):

- error: `loopBreak` / `loopContinue` がループ外に置かれている、`branch.branches` が空 (分岐ゼロ)
- warning: ループ条件式 (`conditionExpression`) 未入力、ループコレクション (`collectionSource`) 未入力、`jump` の jumpTo 未設定または該当 step ID なし、`transactionScope.steps` が空、参照整合性違反 (responseRef / errorCode / systemRef / typeRef / secretRef)、識別子スコープ違反 (@identifier 未定義)、SQL 列名がテーブル定義に無い、`@conv.*` 参照の規約カタログ未定義

## 4. UI component rules

### 4.1 ValidationBadge

`ValidationBadge` は `severity: "error" | "warning"` と `count: number` を受け取る。`count <= 0` の場合は何も描画しない。

error はユーザーが優先的に修正すべき構造違反、warning は設計途中・表示未完成・業務未確認を示す。両方がある場合は error を先に表示する。

### 4.2 MaturityBadge

`MaturityBadge` は `draft` / `provisional` / `committed` を表示する。成熟度未指定は `draft` として描画する。

ListView では view-only とし、クリックや変更操作を持たせない。Editor では `onChange` を渡し、ユーザーが成熟度を変更できるようにする。

### 4.3 shared CSS

validation 表示の共通スタイルは `validation.css` に集約する。カード・行・セクションには `has-error` / `has-warning` クラスを付与し、リソース種別ごとの独自 CSS で意味を変えない。

`has-error` は構造上の修正必須、`has-warning` は設計途中または確認待ちを示す。色・枠線・背景の差は視認性のための表現であり、severity の意味は本仕様に従う。

## 5. Store responsibilities

各 store は、validation 表示に必要な情報を UI に提供する。表示パターンは 2 つあり、リソース構造に応じて
**いずれを採用してもよい**:

### パターン A: store 関数化 (`load<Resource>ValidationMap()`)

```ts
load<Resource>ValidationMap(): Promise<Map<Id, ValidationError[]>>
```

- 適する: validation 結果を複数画面で再利用したい / 計算コストが高くキャッシュしたい / 1 RPC で bulk 取得できる場合
- 例: `loadTableValidationMap()` / `loadViewValidationMap()` (#587 / PR #589)

> **注**: `loadTableValidationMap()` / `loadViewValidationMap()` は backend が `listAllTables()` / `listAllViews()` を提供する場合 1 RPC で全件取得し、未提供時 (localStorage 等) は per-id にフォールバックする (#587 / PR #589 で実装)。bulk fetch 結果は harmony.json entries の ID で filter して orphan 互換性を維持する。

### パターン B: UI 側 inline 構築

ListView / Editor 内で `validate<Resource>(item, allItems)` を直接呼び、Map を局所的に構築する。

- 適する: ProcessFlow のような nested 構造で `aggregateValidation` を再利用する場合 / GenericDefinition のように
  kind 別 instantiate されて store cache 効率が薄い場合 / validator が singleton 軽量で per-render 計算可能な場合
- 例: `ProcessFlowListView.tsx` (`aggregateValidation` 直接呼び出し) / `GenericDefinitionListView.tsx` (kind 別 inline 構築)

### 選択指針

- **デフォルトは inline (パターン B)** — シンプル、新規 UI が即座に動く
- **キャッシュ要件が顕在化したら store 関数化 (パターン A) へ移行** — 計算コスト or N+1 RPC が体感問題化したタイミングで切替

両パターンとも `<ValidationBadge>` / `has-error` / `has-warning` の描画契約は同じ。

## 6. New resource addition checklist

新しい業務リソース種別を追加する場合は、以下を完了してから PR を作成する。

- [ ] `<Resource>Validation.ts` を追加し、`validate<Resource>(item, allItems)` を提供する
- [ ] 4 軸 severity 判定基準に照らして error / warning を分類する
- [ ] validation の単体テストを追加し、error / warning の代表例を含める
- [ ] store に `load<Resource>ValidationMap()` を追加する
- [ ] ListView に `ValidationBadge` を表示する
- [ ] カード表示または行表示に `has-error` / `has-warning` CSS クラスを付与する
- [ ] Editor ヘッダーに `MaturityBadge` を表示し、`onChange` を接続する
- [ ] Editor の該当セクションに `ValidationBadge` または同等の警告表示を配置する
- [ ] schema は AI の変更対象外であることを確認する (#511)
- [ ] schema と手書き validation の severity 不一致がある場合は、意図的な差分として PR に説明する
- [ ] AJV は実行時 UI ではなく test layer の schema 検証として使う

> **kind-discriminated 定義カタログ** (GenericDefinition 系) を追加する場合は本 checklist の `MaturityBadge` 項目を skip し、別途 `generic-definition-layer.md` の checklist に従う。

### 6.1 適用状況

新しいリソース種別が本ポリシーをどこまで実装済みかを示す。

| リソース | validator | ListView Badge | Editor 警告 | MaturityBadge | 完了 PR |
|---|---|---|---|---|---|
| View | ✓ | ✓ | ✓ | ✓ | #585 |
| Table | ✓ | ✓ | ✓ | ✓ | #586 |
| ProcessFlow | ✓ | ✓ | ✓ | ✓ | (#1073 含む各 PR) |
| Generic Definition (8 kind) | ✓ | ✓ | ✓ | N/A* | #1079 |

\* Generic Definition の親 schema (`schemas/v3/generic-definition.v3.schema.json`) に `maturity` field が存在しないため、MaturityBadge は適用不可。schema governance (#511) の対象であり、追加が必要な場合は別 ISSUE を起票して設計者承認を得ること。

## 7. AJV adoption decision

### 7.1 選択肢

AJV 導入方針は次の 3 案を比較した。

| 案 | 内容 |
|---|---|
| A | UI 実行時 validation を AJV に全面移行する |
| B | 現状維持。UI は手書き validator、schema 検証は test layer の AJV に限定する |
| C | hybrid。schema で判定できる項目だけ AJV、UI 固有の severity は手書き validator に残す |

### 7.2 採用方針

本仕様では **C: hybrid** を採用する (#1079 PR #1082 / #1084 で改訂)。

- schema で判定できる項目 (必須欠落 / 型違反 / pattern 違反 / enum 違反 等) は AJV を runtime で使う
- 設計途中の draft-state を許容するための severity 分け (4 軸 severity) や UI 固有 warning は手書き validator が担う

precedent (実装):

- `frontend/src/utils/validateProject.ts` — Project schema を runtime AJV で検証
- `frontend/src/schemas/genericDefinitionValidator.ts` — GenericDefinition 8 kind を runtime AJV で検証 + kind 別 semantic warning

理由:

1. schema 違反は本質的に「型として不正」のシグナルであり、UI で正確かつ統一的に表示すべき → AJV が適任
2. 一方、severity 4 軸判定 (動作可能性 / 物理同一性 / 表示完成度 / 業務妥当性) や draft-state 寛容性は schema では表現しづらい → 手書き validator
3. AJV bundle size (本体 ~30KB gzip) は許容範囲。validateProject / genericDefinition の precedent で動作確認済
4. test layer の AJV (samples-v3.schema.test.ts 等) はそのまま継続。runtime と test の two-layer 体制

### 7.3 hybrid 採用 (§7.2) の根拠となった事象

旧 §7.3 の「将来再検討条件」のうち以下が #1079 (Generic Definition Catalog) で satisfy され、
hybrid 採用に至った:

- **validation 対象が 5 種以上**: GenericDefinition は 8 kind を持ち、kind 別の重複手書き validator を避けるため
  AJV dispatch (`KIND_SCHEMAS` lookup + 親 schema fallback) が保守上有意になった

その他の旧条件 (実際の divergence / 業務要件証跡化) は本判断時点では発生していないが、hybrid 体制下で継続監視する。

### 7.4 適用範囲の明確化 (Conventions / Extensions は対象外)

本ポリシーの適用対象は **業務リソース** (View / Table / ProcessFlow / ViewDefinition / Screen 等、設計者が業務を記述するリソース) に限定する。

以下のフレームワーク基盤側は対象外とする:

| 対象外リソース | 理由 |
|---|---|
| Conventions (規約カタログ `catalog.json`) | フレームワーク定義リソース。業務設計者が設計途中に draft-state で保存するユースケースがなく、validator 経路も未整備のため |
| Extensions (拡張定義 `extensions/*/`) | フレームワーク拡張パッケージ。schema governance (#511) の対象であり、AI が勝手に validator を追加することは禁止されている |

これらを draft-state policy の対象にするには、フレームワーク製作者 (設計者) が新規 ISSUE を起票して承認フローを経る必要がある。

> **e2e spec との対応**: `frontend/e2e/draft-state-validation.spec.ts` の P2-Conventions test は上記判定により by design 恒久 skip とする (#1004 Phase 3 で確定)。

## 8. Related

- #548: View draft-state validation / warning visualization
- #583: Table draft-state validation / warning visualization
- #511: Schema ガバナンス
- #587: validation map の N+1 fetch 回避
- [`docs/spec/schema-governance.md`](schema-governance.md)
- [`docs/spec/process-flow-maturity.md`](process-flow-maturity.md)
- `frontend/src/components/common/ValidationBadge.tsx`
- `frontend/src/components/process-flow/MaturityBadge.tsx`
- `frontend/src/styles/validation.css`
- `frontend/src/utils/viewValidation.ts`
- `frontend/src/utils/tableValidation.ts`
- `frontend/src/utils/actionValidation.ts` (構造ルール)
- `frontend/src/utils/aggregatedValidation.ts` (構造 + 参照整合性 + 識別子スコープ + SQL 列 + 規約参照)
