# Schema v3 Dogfood 評価レポート (#523)

| 項目 | 値 |
|---|---|
| ISSUE | #523 |
| 実施日 | 2026-04-27 |
| 対象 | PR #522 でマージ済の `schemas/v3/` 13 ファイル |
| サンプル所在地 | `docs/sample-project-v3/` |
| AJV 検証 | `frontend/src/schemas/v3-samples.test.ts` (5 tests, 全 pass) |
| 担当 | Opus (主) + Sonnet (1 件比較委譲) |

---

## 1. スコープ・成果物

`docs/sample-project-v3/` に v3 schema 準拠の最小プロジェクト一式を配置:

| 種別 | ファイル | 担当 | 件数 |
|---|---|---|---|
| Project | `project.json` | Opus | 1 |
| Table | `tables/eb574288-...json` (products), `tables/d6db2166-...json` (inventory) | Opus | 2 |
| Screen | `screens/3f378ca7-...json` (店舗在庫照会) | Opus | 1 |
| ProcessFlow | `process-flows/506c266f-...json` (在庫照会) | **Opus** | 1 |
| ProcessFlow | `process-flows/a3a129e5-...json` (カート追加) | **Sonnet** | 1 |
| Extension | `extensions/retail.v3.json` | Opus | 1 |
| **合計** | — | — | **7 ファイル** |

検証手段:

```ts
// frontend/src/schemas/v3-samples.test.ts
const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
addFormats(ajv);
ajv.addSchema(common); ajv.addSchema(screenItem);
// 各 entity 別に compile し、全 sample を validate
```

```
✓ project.json validates against project.v3.schema.json
✓ table samples validate against table.v3.schema.json (2)
✓ screen samples validate against screen.v3.schema.json (1)
✓ process-flow samples validate against process-flow.v3.schema.json (2)
✓ extension samples validate against extensions.v3.schema.json (1)
```

---

## 2. 3 分類別 件数集計

memory `feedback_dogfood_issue_classification.md` 準拠で問題を分類:

### 2.1 フレームワーク (schema 自体の改善) — 4 件

| # | 内容 | 重要度 | 推奨 |
|---|---|---|---|
| F-1 | Project 以外 (table / screen / process-flow / extension) の root に `$schema` 属性を書けない (`unevaluatedProperties: false` で reject) | Should-fix | 全 entity root schema に `$schema: { type: "string" }` 追加 (IDE / editor 連携の標準慣行) |
| F-2 | `ExtensionStep` に `lineage` を持たせられない (StepBaseProps にないため `unevaluatedProperties: false` で reject)。Sonnet が踏んだ罠 | Should-fix | StepBaseProps に optional `lineage` 移植 OR ExtensionStep 専用に lineage 追加 (拡張 step がデータ系譜を宣言できる方が監査用途で有用) |
| F-3 | EventTopic 命名規範が v1 sample (`inventory.notFound`, `cart.item_added`) と非互換 — v3 EventTopic は `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` (lowercase + underscore のみ)。サンプル時に `inventory.not_found` 等への rename 強制 | 要文書化 | `schemas/v3/README.md` に「v1/v2 → v3 移行時の rename 注意」セクション追加。v1 sample の機械的 v3 化は不能 (人手判断が要る) |
| F-4 | `outputBinding` の string 短縮形 (`"product"`) を `{ name: "product" }` 構造化に強制したことで sample が冗長化。AI 実装的には判別容易 (kind 不要のため) なので妥当だが、人間記述では負担増 | 容認範囲 | README で「短縮形廃止の意図」を再強調 (混乱回避) |

### 2.2 拡張定義 (extensions.v3 の改善) — 2 件

| # | 内容 | 重要度 | 推奨 |
|---|---|---|---|
| E-1 | 1 ファイル統合運用 (1 namespace = 1 file) は **retail 程度の規模 (8 fieldType + 4 stepKind + 1 screenKind + 2 responseType + ...) では問題なし**。Opus サブエージェントが懸念した「retail/finance で 1 ファイル肥大化」は本サンプルでは未発現 (134 行) | 容認範囲 | finance / manufacturing 等の大型 namespace で再評価 |
| E-2 | `stepKinds` / `responseTypes` は object (PascalCase キー)、`fieldTypes` / `dataTypes` / `valueSourceKinds` 等は array (kind/value プロパティ持ち) — Sonnet 指摘の「object/array 不統一」は dogfood で実体感あり。loader 実装時に吸収可能だが**仕様読解者は迷う** | Should-fix (将来) | v3.1 で全部 array 化、または全部 object 化を検討 (混在は loader / IDE 補完の挙動が分かれる) |

### 2.3 サンプル設計 (記述ミス系) — 2 件

| # | 内容 | 重要度 | 対処 |
|---|---|---|---|
| S-1 | Sonnet が cart sample で参照した tableId (`9315e226-...`, `42502d05-...`) と screenId (`aaaaaaaa-0002-4000-8000-aaaaaaaaaaaa`) は本リポジトリに該当 entity ファイルが存在しない (placeholder UUID で生成) | 既知 | AJV (構造) は pass、`referentialIntegrity.ts` (対参照) は別途 v3 化が必要 (#523 後続 ISSUE) |
| S-2 | Sonnet が初回 ExtensionStep に `lineage` を top-level で書き AJV reject、`config` 内に移して pass。F-2 とリンク (フレームワーク側修正で解消可能) | 既知 | F-2 修正で対処 |

---

## 3. v3.1 候補 6 項目の実体感 (memory `project_schema_v3_2026_04_27.md` §v3.1)

| # | 候補 | 検証結果 | 判断 |
|---|---|---|---|
| 1 | ProcessFlow root 4 セクション化の認知負荷 | **Opus**: 自分で書く分は楽 (catalog の意味的グルーピングが効いて root 並列肥大化なし)。 **Sonnet**: 「v1 の `errorCatalog` 等が `context.catalogs.errors` に降りた点が最初に混乱、v1 と並行しながら変換した」と報告。**初見コスト ≠ 維持コスト**、初見は重いが構造把握後は楽 | **v3 のまま (容認範囲)**。README に「v1 移行マッピング表」追加で初見コスト緩和 |
| 2 | `context.health` / `readiness` / `resources` 位置 | dogfood サンプルで未使用。retail シンプルケースでは不要。運用フェーズの ProcessFlow (定常バッチ等) で使用感が出る | **判断保留**、v3.0 のまま、運用層 ProcessFlow が増えた時点で再評価 |
| 3 | 拡張機構 1 ファイル統合の限界 | retail で 134 行、`extensions.v3.json` 1 ファイル統合は十分扱える。複数ファイル分割運用は loader 側の許容で十分 | **容認範囲**、finance / manufacturing で再評価 |
| 4 | Step.oneOf 22 variant の AI/validator 認知負荷 | **Sonnet 報告**: 「discriminator: true でも 22 branch のエラーが出力されるため根本原因特定に時間」。実機計測でも、誤った step kind 選択時のエラー読解は `discriminator: true` でかなり緩和されるが完全ではない (合成 schema の各 variant validator 内エラーが出る) | **容認範囲**、新 step variant 追加時は README §AJV ヒントで discriminator 推奨を再強調 |
| 5 | ValidationStep.conditions と rules の同居 | **Opus**: v1 sample が両方使っていたためそのまま v3 移植したが、conditions は人間向け概要、rules が実行 spec で意味分離されている。spec 文書で明記すれば容認 | **v3 のまま (容認範囲)**、`docs/spec/process-flow-validation.md` に明記 |
| 6 | 拡張機構の object/array 不統一 | **dogfood で実体感あり** (E-2)。retail.v3.json を読みながら「stepKinds は object key で参照、fieldTypes は array.kind で参照」を頭で切り替えるのが煩雑 | **v3.1 候補に格上げ**、全部 array 化 or 全部 object 化を検討 (互換性影響あり、別 ISSUE) |

---

## 4. 後続 ISSUE 優先順位提案

memory `project_schema_v3_2026_04_27.md` の後続 ISSUE 候補 7 件について、本 dogfood 結果を踏まえた優先順位:

| 優先度 | 後続 ISSUE | 理由 |
|---|---|---|
| **高** | F-1, F-2 (schema 修正) | 2 件とも sample 作業中に踏んだ罠で v3.0 内 fix 推奨。`$schema` は IDE/editor 連携の標準。lineage は監査用途で有用 |
| **高** | TS 型同期 (`frontend/src/types/`) | UI / validator 着手前に型基盤が揃っている必要がある。手動 type 定義 or zod 検討は Opus サブエージェント懸念事項 |
| **中** | sample 全件 v3 化 (`docs/sample-project/process-flows/*` 4 件 → 全部 v3 移植) | dogfood では 2 件のみ。残り 2 件 (受注確定 / 配送指示) を v3 化して既存 dogfood 検証済 sample をリプレース |
| **中** | validator 切替 (`referentialIntegrity / sqlColumnValidator / loadExtensions / conventionsValidator`) | S-1 の「AJV では拾えない参照整合」を v3 entity (Uuid 参照体系) で再構築 |
| **中** | spec 文書 v3 反映 (`docs/spec/process-flow-*.md` 14 件) | F-3 の v1→v3 マッピング表、5. ValidationStep.conditions の意味分離も spec で明記 |
| **低** | UI コンポーネント v3 同期 (30+ ファイル) | TS 型同期完了後。複合 schema loader 統一が見える化される |
| **低** | 業界別実拡張 namespace (finance / manufacturing) | E-1 の 1 ファイル統合の限界を実測する材料 |
| **将来** | E-2 (object/array 不統一) を v3.1 で吸収 | breaking change を伴うため安易には進められない |

---

## 5. 結論

- v3 schema は **AJV (`discriminator: true`)** で全 7 sample を一発検証可能。schema レベルの設計は dogfood で大きな破綻なし
- v3.1 候補 6 項目のうち **#6 (object/array 不統一) のみ実体感が強く、要対応**。残り 5 項目は容認範囲または運用層が増えた時点で再評価
- フレームワーク改善 2 件 (F-1 `$schema` 許容 / F-2 lineage の ExtensionStep 透過) は **v3.0 内で fix** を推奨 (どちらも sample 作業中に踏んだ罠)
- v1 → v3 移行は機械的に行えない (EventTopic rename / outputBinding 構造化 / catalog 階層化 / Uuid strict 化)。spec 文書で v1 → v3 マッピング表を整備することが次の手

下流作業 (TS 型同期 / validator 切替 / UI 移行 / spec 反映) は本 dogfood 完了後、別 ISSUE で順次着手。
