# docs/spec/

本プロジェクトの UI・操作・内部 API の詳細仕様を集約する場所。

## 現在の仕様書

| ファイル | 対象 | 関連 issue |
|---|---|---|
| [list-common.md](list-common.md) | 一覧系画面の操作・見た目・内部 API (選択・キーボード・D&D・コピペ・ソート・フィルタ・Read-only モード・No 列永続フィールド) | #133 / #148 |
| [process-flow-maturity.md](process-flow-maturity.md) | 成熟度・付箋・上流/下流モード (Phase 1 基盤) | #151 / #152 |
| [process-flow-variables.md](process-flow-variables.md) | 変数・入出力・outputBinding (Phase 1 基盤) | #151 / #152 |
| [process-flow-extensions.md](process-flow-extensions.md) | HTTP 契約 / TX / Saga / 外部 outcomes / ValidationRule / compute / return (Phase B) | #151 / #182 |
| [process-flow-sla.md](process-flow-sla.md) | SLA / Timeout 宣言 (ProcessFlow / ActionDefinition / StepBase) | #412 |
| [process-flow-criterion.md](process-flow-criterion.md) | Criterion (ExternalSystemStep の `successCriteria`、Arazzo 1.0 互換、`$` Runtime Expression 推奨) | #427 |
| [process-flow-tier-c.md](process-flow-tier-c.md) | Tier C 拡張 — circuitBreaker / bulkhead / ClosingStep / CdcStep / health / readiness / resources | #426 |
| [process-flow-expression-language.md](process-flow-expression-language.md) | runIf / expression / bodyExpression の式言語 BNF (js-subset) | #253 |
| [process-flow-runtime-conventions.md](process-flow-runtime-conventions.md) | SQL 式補間 / HTTP body シリアライズ / TX×throw×tryCatch / fireAndForget / sideEffects TX 境界等の実行時規約 | #261 |
| [process-flow-external-system.md](process-flow-external-system.md) | ExternalSystemStep の OpenAPI operation 参照 (`openApiSpec` / `operationRef`) | #413 |
| [process-flow-testing.md](process-flow-testing.md) | 処理フローの Given-When-Then テストシナリオ (`testScenarios`) | #400 |
| [process-flow-workflow.md](process-flow-workflow.md) | WorkflowStep / WorkflowPattern (承認ワークフロー標準 11 パターン) | #411 |
| [process-flow-env-vars.md](process-flow-env-vars.md) | 環境変数カタログ (`envVarsCatalog`) — 環境別 (dev/staging/prod) の型付き設定値 | #414 |
| [process-flow-secrets.md](process-flow-secrets.md) | Secrets カタログ (`secretsCatalog`) — 秘匿値メタデータ + 環境別参照式 | #261 / #414 |
| [process-flow-transaction.md](process-flow-transaction.md) | `TransactionScopeStep` (複数 DB 操作を 1 TX でまとめる meta-step) と既存 `txBoundary` の関係 | #415 |
| [process-flow-ai-step-kind.md](process-flow-ai-step-kind.md) | AI step kind (`aiCall` / `aiAgent`) と `modelEndpoints` catalog — provider 抽象 / tool use / structured output / vision input (業界標準形式準拠) | #935 |
| [screen-items.md](screen-items.md) | 画面項目定義 (フォーム系バリデーション 3 層のうち「画面」層) — **ドラフト v0.1** | #318 |
| [view-definition.md](view-definition.md) | ViewDefinition (画面 一覧 UI viewer) — 3 レベル DSL (Simple / Structured / Raw SQL) / items[] の direction:viewer 連携 / kind 別レイアウト / validator 11 観点 | #649 / #666 / #745 / #761 |
| [plugin-system.md](plugin-system.md) | プラグインシステム — ソース変更なしにスキーマ・ステップ型・enum を拡張する仕組み | #390 |
| **[multi-editor-puck.md](multi-editor-puck.md)** | **マルチエディタ対応 (Puck 併設)** — 画面ごとに editorKind / cssFramework を選択可能 + 二層モデル (semantic props 永続化 + utility class 出力) + リアルタイム WYSIWYG + 動的コンポーネント登録。`css-framework-switching.md` の画面単位化改訂を含む | 2026-05-05 メタ ISSUE |
| [dogfood-2026-04-26-finance.md](dogfood-2026-04-26-finance.md) | 金融複合業務ドッグフード評価レポート (2026-04-26、6 シナリオで 5/5 達成) | #458 |
| [dogfood-2026-04-26-manufacturing.md](dogfood-2026-04-26-manufacturing.md) | 再ドッグフード (製造業) 評価レポート — Codex 抜き / Sonnet vs Opus 比較 / 3 分類別件数集計 | #478 |
| [dogfood-2026-04-27-logistics-create-flow-validation.md](dogfood-2026-04-27-logistics-create-flow-validation.md) | `/create-flow` 効果検証レポート (物流業務、Must-fix 50-75% 削減) | #486 |
| [dogfood-2026-04-27-phase4-retail-validation.md](dogfood-2026-04-27-phase4-retail-validation.md) | Phase 4 全仕様書統合検証レポート — retail (既存退避→AI 生成→改善ループで Must-fix ゼロ達成) | #500 / #506 |
| **[draft-state-policy.md](draft-state-policy.md)** | **draft-state policy** (設計途中許容 + UI 警告可視化の 5 原則 / severity 判定 / 新規リソース追加 checklist / AJV 導入要否) | #584 (Phase 1: #548 / Phase 2: #583) |
| **[schema-governance.md](schema-governance.md)** | **最重要**: グローバル定義スキーマ変更ガバナンス (AI による勝手拡張を構造的に禁止) | #511 |
| **[sample-project-structure.md](sample-project-structure.md)** | サンプルプロジェクト構造 (v3) — 各サブディレクトリは独立した業務アプリで、規約カタログを含む成果物を個別に持つ。プロジェクト横断の単一ファイル配置は禁止 | #607 |
| **[schema-design-principles.md](schema-design-principles.md)** | **schema を どう書くか の規範** — 命名 / 構造 / フォーマット / コード補完 / 拡張判断 / 後方互換 / テスト規約 / 既知課題 | #517 |
| **[workspace.md](workspace.md)** | ワークスペース (project) のライフサイクル / lockdown / プロトコル / 並行制御 — 複数ワークスペース管理機能 v1 の正規仕様 | #27 / #671-#676 / #678 |
| **[workspace-multi.md](workspace-multi.md)** | マルチワークスペース対応 (v2) — per-session active state / URL `/w/:wsId/` / VSCode モデル | #679 |
| **[path-conventions.md](path-conventions.md)** | 永続化データの配置規約 (Harmony state / 成果物 / built-in リソース 3 カテゴリ) + container 配布時の mount 戦略 + `HARMONY_HOME` 環境変数 | #1055 |
| **[edit-session-draft.md](edit-session-draft.md)** | **サーバ側 draft 管理モデル** — 全エディタ明示保存 + ロック排他 + AI 連携 (D-1〜D-12 / 状態遷移図 / owner-actor 分離 / リスクマトリクス) | #683 / #684 |
| **[edit-session-protocol.md](edit-session-protocol.md)** | **協調編集の正規プロトコル** — EditSession 一級概念 / 1-6 step ライフサイクル / role と take-over atomic / 複数 EditSession 並存 / TTL / AI 識別 (`Alice@AI`) — `collab-presence.md` の発展的後継 | #876 派生 / #855 |
| [collab-presence.md](collab-presence.md) | 協調編集 (Direction B) overture — 採用根拠 / Forward-Compat 4 原則 / Activity taxonomy (正規プロトコルは `edit-session-protocol.md` 参照) | #876 / #855 |
| [schema-audit-2026-04-27.md](schema-audit-2026-04-27.md) | Schema 変更履歴監査レポート — 過去 102 コミット精査、(A) 正当 88% / (B) 不規則 2-3% / (C) 不適切 0% | #511 (Phase B-1) |
| [e2e-vite-stability.md](e2e-vite-stability.md) | Vite dev server multi-context e2e crash 調査 + 既知回避策 + 再現 scaffold spec | #992 |
| **[generic-definition-layer.md](generic-definition-layer.md)** | **汎用設計定義レイヤー (RFC v0.2)** — 既存 entity 構造化拡張 + Generic Definition Catalog (8 kind: data-contract / domain-type / exception-type / application-rule / ui-behavior / runtime-policy / component-definition / ui-fragment) + AI 向け変換マニュアル方式。配置 `examples/<project>/<dataDir>/generic-definitions/<kind>/*.json` (実例: examples/retail/harmony/...) | #1060 |
| **[conversion-guideline-for-ai.md](conversion-guideline-for-ai.md)** | **Markdown → Harmony JSON 変換ガイドライン (AI 向け、RFC v0.1)** — entity 構造 / archetype 10 種類別の落とし方 (§3.1〜§3.7 に JSON before/after pair 付き、§3.8/§3.9 は概要のみ) / Generic Definition catalog の共通メタモデル / audit warning 12 種 / 1 回限り変換 vs Importer 生成の判断 / TS scaffold テンプレ / 既知落とし穴 / decision flowchart。`/import-md` skill 起動点 | #1060 |

**一次成果物**: JSON スキーマ [`schemas/process-flow.schema.json`](../../schemas/process-flow.schema.json) ([README](../../schemas/README.md))。仕様書と突合する機械可読版。

## 位置づけ

- `CLAUDE.md` (リポジトリ直下) — プロジェクト全体のアーキテクチャ・規約・コマンド
- `docs/spec/*.md` — 個別機能の詳細仕様（長い・詳細・一次情報）
- `docs/design-server-storage.md` / `docs/porting/` 等 — 設計/調査ドキュメント

仕様が分かりにくい・矛盾する・古くなっている場合は、**仕様書側を更新**してから実装。コード側のコメントやイシューに詳細を書くと必ず drift する。
