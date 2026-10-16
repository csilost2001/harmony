# docs/spec/

本プロジェクトの UI・操作・内部 API の詳細仕様を集約する場所。

## 現在の仕様書

| ファイル | 対象 | 関連 issue |
|---|---|---|
| [design-document.md](design-document.md) | 設計書ビュー (/document) と HTML 出力、CRUD 図の導出規則 | 再設計 2026-10 |
| [screen-layout.md](screen-layout.md) | 画面レイアウト (業務部品の木)・業務部品デザイナ・旧デザインからの自動変換 | 再設計 2026-10 |
| [layout-components.md](layout-components.md) | プロジェクト独自部品 (登録・差し込み口・展開・管理 UI) | 再設計 2026-10 |
| [test-viewpoints.md](test-viewpoints.md) | テスト観点表 (画面入力の正常・異常・境界値を項目の制約から導出、処理の観点に ID を付与。CSV / JSON / Markdown に書き出し) | 再設計 2026-10 |
| [references.md](references.md) | 参照元 (その設計を参照している設計の一覧。改名・削除の前の影響確認。UI の「参照元」/ MCP `designer__find_references`) | 再設計 2026-10 |
| [ui-markers.md](ui-markers.md) | マーカー (AI への指示・質問): どの設計にも付けられる・MCP が画面と同じ場所を読み書き・全設計の一覧と集計・AI に渡す文・Ctrl+Alt+M | UI 第 4 弾 |
| [ui-keyboard.md](ui-keyboard.md) | キーボード・移動 (画面内検索 Ctrl+F・参照元 Shift+F12・表の Ctrl+D / 行の挿入・複製・削除・コマンドパレットの画面の操作・F6・部品の追加・ダイアログのキー) | UI 第 2 弾 |
| [ui-direct-manipulation.md](ui-direct-manipulation.md) | ドラッグ・直接操作・一括 (画面デザイナの文言のその場編集・右クリック・複数選択・段の幅・属性コピー、一覧の列の設定・条件で選ぶ・表としてコピー、行の並べ替え・オートフィル、図の拡大縮小・ER のカラムから線・画面フローの線、タブのドラッグ、ファイルのドロップ、参照の付け替え) | UI 第 3 弾 |
| [ui-input-reliability.md](ui-input-reliability.md) | 入力の信頼性・見通し (欄の直下の指摘と直し方・式の書き間違い・近い名前・保存の状態・変更した欄・取り消した内容の通知・取り消せる削除・F8 で次の要確認・目次・直接のリンク・入力専用モード・全角の正規化・操作数の予算) | UI 第 5 弾 |
| [ui-lists-navigation.md](ui-lists-navigation.md) | 一覧・探索・見通し (閉じたタブを開き直す・画面の履歴・パンくず・保存した絞り込み・グループ表示・のぞき見・まとめての操作・最近開いた順・行の印・CSV / Excel・近い名前・使っているもの・Ctrl+K の接頭辞・今日やること) | UI 続編 第 6 弾 |
| [ui-diagrams.md](ui-diagrams.md) | 図・可視化 (図の検索・強調・絞り込み・整列とガイド・ER のカラム表示・線の形・凡例・書き出し・印刷・基準との差分・表示位置の記憶・つながり図・処理フローの流れ図とシーケンス図・画面フローの自動配置) | UI 続編 第 7 弾 |
| [ui-editing-depth.md](ui-editing-depth.md) | 編集体験の深掘り (画面デザイナのサンプル値・状態・寸法・部品検索 / 処理フローの畳み・変数・囲む・判定表・式の試し実行・机上演習 / テーブルの型変更の影響・サンプル INSERT・インデックス提案 / 画面項目の食い違い / スクロール復元・最後の編集へ・クリップボード履歴・用語ゆれ) | UI 続編 第 8 弾 |
| [ui-input-assist.md](ui-input-assist.md) | 入力補助 (参照の補完・SQL の表名とカラム名・定義へ移動・検索できる選択・カラムの物理名と型の提案・外部キーの候補・テーブルから画面項目・ID の候補・工程のおすすめ・IME) | UI 第 1 弾 |
| [ux-operations.md](ux-operations.md) | 操作性 (通知の履歴・表示の設定・お気に入り・コマンドパレット・変更履歴・一括変更・別画面へのコピー・スニペット・検索置換・表で編集・キーボード代替・ツアーとヘルプ・並べて表示・エラー復旧) | 第 4 弾 |
| [design-analysis.md](design-analysis.md) | 設計の分析 (影響分析・対応表・未使用・用語・命名規約・メッセージ・操作単位の権限・SLA / ジョブ・外部システムの契約・進捗・テスト雛形・テストデータ・OpenAPI・DDL の差分) | 第 3 弾 |
| [design-check.md](design-check.md) | 点検の設定 `design-check.json` (要確認の抑制・独自の検査ルール) | 第 3 弾 |
| [integration-ops.md](integration-ops.md) | 連携と運用 (Word / Excel 書き出し・設計書の体裁と改訂履歴・図の書き出し・Git・レビューコメント・承認・利用者と権限・変更の記録・通知・DDL / OpenAPI / Excel の取り込み・生成の管理・技術スタックのプリセット・版とリリースノート・初回セットアップ・資料の鮮度検査) | 第 5 弾 |
| [code-generation.md](code-generation.md) | AI コード生成プロトコル (`project.techStack` に基づく指針。`/generate-code` skill) | #826 / #832 |
| [design-payload-storage.md](design-payload-storage.md) | **廃止 (2026-10)** 旧エディタ (GrapesJS) の編集内容の保存の形 (記録として残す) | #1448 |
| [examples-english-learning.md](examples-english-learning.md) | `examples/english-learning/` (英会話学習アプリ) の業務スコープ・データモデル・画面構成 | #787 |
| [examples-retail.md](examples-retail.md) | `examples/retail/` (リテール総合) の業務スコープ・データモデル・画面構成 | #706 |
| [page-layout.md](page-layout.md) | PageLayout + Gadget (共通ヘッダ / フッタ / サイドバーなどの layout 横断部品) | #1021 |
| [process-flow-prefix-system.md](process-flow-prefix-system.md) | ProcessFlow の参照 prefix 24 種 + 階層参照 (`@<key>` 統一記法) | #1254 / #1263 |
| [schema-deletions-record.md](schema-deletions-record.md) | スキーマ削除事項の記録 (不採用の提案・削除した field) | #1254 / #1263 |
| [schema-v3-design.md](schema-v3-design.md) | スキーマ v3 横断再設計案 (Opus 設計版) | #521 |
| [spec-package.md](spec-package.md) | `@harmony/spec` package contract (schema・仕様・サンプルを読み取り専用の参照として配る単位) | #1472 |
| [file-backup.md](file-backup.md) | 保存前の版 (上書きされる前の内容を世代で残す・画面と MCP からの確認・読み込み) | 第 1 弾 |
| [external-change-detection.md](external-change-detection.md) | 外部で書き換えられた設計ファイルの検知 (ファイル監視・画面への反映・自分の書き込みの除外) | 第 1 弾 |
| [workspace-health.md](workspace-health.md) | ワークスペースの健全性 (壊れた JSON・食い違いの検査、一覧・uuid の保守、複数ファイル操作の復旧、旧形式の画面の扱い) | 第 1 弾 |
| [server-security.md](server-security.md) | サーバの守り (Origin・パス・ログのマスク、接続トークン、要求の上限、MCP の権限) | 第 1 弾 |
| [schema-migration.md](schema-migration.md) | スキーマの版の移行の枠組み (予行・世代・冪等) | 第 1 弾 |
| [quick-open.md](quick-open.md) | クイックオープン (Ctrl+K。画面・テーブル・処理フロー等を ID・名前で探して開く) | 再設計 2026-10 |
| [report.md](report.md) | 帳票 (出力・契機・出力条件・部と項目・用紙の見本図・検証・編集 UI・MCP) | 再設計 2026-10 段階 4 |
| [business-flow.md](business-flow.md) | 業務フロー (スイムレーン。レーン・工程・自動配置・検証・編集 UI・MCP) | 再設計 2026-10 段階 4 |
| [list-common.md](list-common.md) | 一覧系画面の操作・見た目・内部 API (選択・キーボード・D&D・コピペ・ソート・フィルタ・Read-only モード・No 列永続フィールド) | #133 / #148 |
| [process-flow-maturity.md](process-flow-maturity.md) | 成熟度・付箋・上流/下流モード (Phase 1 基盤) | #151 / #152 |
| [process-flow-variables.md](process-flow-variables.md) | 変数・入出力・outputBinding (Phase 1 基盤) | #151 / #152 |
| [process-flow-extensions.md](process-flow-extensions.md) | HTTP 契約 / TX / Saga / 外部 outcomes / ValidationRule / compute / return (Phase B) | #151 / #182 |
| [process-flow-sla.md](process-flow-sla.md) | SLA / Timeout 宣言 (ProcessFlow / ActionDefinition / StepBase) | #412 |
| [process-flow-substeps.md](process-flow-substeps.md) | 工程の入れ子 (`subSteps`) の形・実行の意味・走査 | #1487 |
| [process-flow-keyboard.md](process-flow-keyboard.md) | 処理フローのキーボード操作 (工程の移動・開閉・挿入・Tab のインデント) | - |
| [grid-keyboard.md](grid-keyboard.md) | 表の入力のキーボード操作 (画面項目の行移動・カラムの編集パネルの連続入力) | - |
| [process-flow-outline.md](process-flow-outline.md) | 処理フローのアウトライン (1 行 1 工程のテキスト) 編集 (試作) | - |
| [process-flow-criterion.md](process-flow-criterion.md) | Criterion (ExternalSystemStep の `successCriteria`、Arazzo 1.0 互換、`$` Runtime Expression 推奨) | #427 |
| [process-flow-tier-c.md](process-flow-tier-c.md) | Tier C 拡張 — circuitBreaker / bulkhead / ClosingStep / CdcStep / health / readiness / resources | #426 |
| [process-flow-expression-language.md](process-flow-expression-language.md) | runIf / expression / bodyExpression の式言語 BNF (js-subset) | #253 |
| [process-flow-runtime-conventions.md](process-flow-runtime-conventions.md) | SQL 式補間 / HTTP body シリアライズ / TX×throw×tryCatch / fireAndForget / sideEffects TX 境界等の実行時規約 | #261 |
| [process-flow-external-system.md](process-flow-external-system.md) | ExternalSystemStep の OpenAPI operation 参照 (`openApiSpec` / `operationRef`) | #413 |
| [process-flow-testing.md](process-flow-testing.md) | 処理フローの Given-When-Then テストシナリオ (`testScenarios`) | #400 |
| [process-flow-workflow.md](process-flow-workflow.md) | WorkflowStep / WorkflowPattern (承認ワークフロー標準 11 パターン) | #411 |
| [process-flow-env-vars.md](process-flow-env-vars.md) | 環境変数カタログ (`envVarsCatalog`) — 環境別 (dev/staging/prod) の型付き設定値 | #414 |
| [process-flow-secrets.md](process-flow-secrets.md) | Secrets カタログ (`secretsCatalog`) — 秘匿値メタデータ + 環境別参照式 | #261 / #414 |
| [process-flow-transaction.md](process-flow-transaction.md) | `TransactionScopeStep` (複数 DB 操作を 1 TX でまとめる meta-step、v3 で TX 表現一本化、旧 `txBoundary` は #1221 で廃止) | #415 / #1221 |
| [process-flow-ai-step-kind.md](process-flow-ai-step-kind.md) | AI step kind (`aiCall` / `aiAgent`) と `modelEndpoints` catalog — provider 抽象 / tool use / structured output / vision input (業界標準形式準拠) | #935 |
| [screen-items.md](screen-items.md) | 画面項目定義 (フォーム系バリデーション 3 層のうち「画面」層) — **ドラフト v0.1** | #318 |
| [view-definition.md](view-definition.md) | ViewDefinition (画面 一覧 UI 表示定義) — 3 レベル DSL (Simple / Structured / Raw SQL) / items[] の `presentation.viewDefinitionId` 連携 / kind 別レイアウト / validator 11 観点 | #649 / #666 / #745 / #761 / #1445 |
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
| **[generic-definition-layer.md](generic-definition-layer.md)** | **汎用設計定義レイヤー (RFC v0.2)** — 既存 entity 構造化拡張 + Generic Definition Catalog (現行 17 kind、`ui-fragment` は #1436 で廃止) + AI 向け変換マニュアル方式。配置 `examples/<project>/<dataDir>/generic-definitions/<kind>/*.json` (実例: examples/retail/harmony/...) | #1060 |
| **[conversion-guideline-for-ai.md](conversion-guideline-for-ai.md)** | **Markdown → Harmony JSON 変換ガイドライン (AI 向け、RFC v0.1)** — entity 構造 / archetype 10 種類別の落とし方 (§3.1〜§3.7 に JSON before/after pair 付き、§3.8/§3.9 は概要のみ) / Generic Definition catalog の共通メタモデル / audit warning 12 種 / 1 回限り変換 vs Importer 生成の判断 / TS scaffold テンプレ / 既知落とし穴 / decision flowchart。`/import-md` skill 起動点 | #1060 |
| [react-exporter.md](react-exporter.md) | **廃止 (2026-10)** `designer__export_screen` MCP tool 用 HTML→JSX 機械変換器 (backend/reactExporter.ts) の存在意義 / `/generate-code` skill との関係 / 14 event placeholder | #1147 (N-8) |

**一次成果物**: JSON スキーマ [`schemas/v3/process-flow.v3.schema.json`](../../schemas/v3/process-flow.v3.schema.json) ([README](../../schemas/v3/README.md))。仕様書と突合する機械可読版。

## 位置づけ

- `CLAUDE.md` (リポジトリ直下) — プロジェクト全体のアーキテクチャ・規約・コマンド
- `docs/spec/*.md` — 個別機能の詳細仕様（長い・詳細・一次情報）
- `docs/design-server-storage.md` / `docs/porting/` 等 — 設計/調査ドキュメント

仕様が分かりにくい・矛盾する・古くなっている場合は、**仕様書側を更新**してから実装。コード側のコメントやイシューに詳細を書くと必ず drift する。
