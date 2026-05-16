# 処理フロー編集ワークフロー

**目的**: 業務担当者が書く「概要レベルの処理フロー」を、AI エージェント (Claude Code) と往復しながら「AI 実装者が迷わず実装できる詳細レベル」まで引き上げる。

## 位置づけと原則

1. **一次成果物は JSON スキーマに準拠した処理フロー JSON** (`schemas/process-flow.schema.json`)
2. 上流の概要は人間が書く、詳細化は AI が行う (完全自動ではなく、人間と対話しながら)
3. API 課金は発生しない (Anthropic Claude Code Max プラン内で完結)
4. designer 画面は**リッチなコンテキスト保持器** (AI への指示・質問・注目点を保存)

## 全体の流れ

```
┌─ 上流 (人間主体、maturity=draft) ──────────────────────────────────┐
│ 1. 新規処理フロー作成 (処理フロー一覧 → 新規作成)                   │
│ 2. アクション (ボタンクリック等) と ステップ (検証/DB/外部/...) を追加 │
│ 3. 各ステップは概要だけ書く (description に 1-2 行)                │
│ 4. 穴は付箋 (StepNote) や AI マーカーで明示                        │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌─ AI 往復 (人間がマーキング → Claude Code が MCP で編集) ────────────┐
│ 5. 画面上でマーキング (AI マーカー追加)                             │
│    - 「ここの SQL 書いて」→ kind=todo + stepId で該当 step に付ける │
│    - 「これで合ってる?」→ kind=question                             │
│    - 「ここ注意して見て」→ kind=attention                           │
│ 6. 別 Claude Code 窓で `/designer-work <processFlowId>` 実行          │
│ 7. Claude Code は MCP tool で list_markers → 各 marker を kind 別に処理 │
│    → update_step / add_catalog_entry 等で編集                      │
│    → resolve_marker で応答メモを残す                               │
│ 8. ブラウザは wsBridge broadcast で自動再描画                       │
│ 9. 人間は結果を観察、未解決/新規質問があれば追加マーキング → 6 へ戻る │
└────────────────────────────────────────────────────────────────────┘
                            ↓
┌─ 下流 (AI 実装前チェック、maturity=committed) ──────────────────────┐
│ 10. モードを "downstream" に切替                                    │
│ 11. 未確定警告を解消 (maturity 昇格、カタログ埋め、参照整合性)       │
│ 12. Schema 検証 + 参照整合性バリデータで clean 確認                  │
│ 13. 別 AI セッションに JSON を渡して実装依頼                         │
└────────────────────────────────────────────────────────────────────┘
```

## 1. 新規作成

「処理フロー一覧」画面 (`/process-flow/list`) から「+ 新規作成」で ProcessFlow を作る。

- **名前**: 画面/画面遷移の業務名 (例: 注文登録画面)
- **種別**: screen / batch / scheduled / system / common / other
- **モード**: 初期は `upstream` (概要レベル)
- **成熟度**: 初期は `draft`

## 2. アクション・ステップの追加

ProcessFlow 内に複数の **アクション** (ボタンクリック等のイベント単位) を作り、アクション内に **ステップ** (検証/DB操作/外部呼出/画面遷移 等) を積む。

主なステップ種別 (v3 schema 由来、抜粋):

| 種別 | 用途 |
|------|------|
| validation | 入力検証 |
| dbAccess | DB CRUD |
| externalSystem | 外部 API 呼出 |
| commonProcess | 共通処理参照 |
| componentCall | コンポーネント呼出 |
| screenTransition | 画面遷移 |
| displayUpdate | 表示更新 |
| branch | 条件分岐 |
| loop / loopBreak / loopContinue | ループ |
| jump | ジャンプ |
| compute | 純粋計算・代入 |
| return | HTTP レスポンス返却 |
| aiCall | AI 呼出 (構造化 JSON 出力) |
| aiAgent | AI エージェント (tool use 連携) |
| workflow | サブワークフロー (承認・エスカレーション・quorum 等) |
| transactionScope | 構造的トランザクション |
| log | ログ記録 |
| audit | 監査ログ |
| eventPublish / eventSubscribe | イベント駆動 |
| cdc | CDC (Change Data Capture) |
| closing | 締め処理 |

注: `tryCatch` / `expression` / `affectedRowsZero` 等は **`BranchCondition.kind`** (`branch` step 内の条件種別) であり、独立した step ではない。`structuredObject` / `streaming` 等は `aiCall` の outputType / Message content の kind。完全列挙は [`schemas/v3/process-flow.v3.schema.json`](../../schemas/v3/process-flow.v3.schema.json) を直接参照。

## 3. 概要だけ書く (draft)

各ステップの詳細 (SQL 本文、外部 API 仕様、条件式) は未確定でよい。最小限:

- `description` に 1-2 行で「何をするステップか」
- 必要なら `note` (付箋) で「想定:」「TODO:」等を明示

## 4. カタログを埋める

詳細化の過程で、ProcessFlow レベルのカタログに情報を集約する (ProcessFlowEditor 上部に編集パネル):

- **errorCatalog** — エラーコード (STOCK_SHORTAGE 等) の HTTP ステータス・デフォルトメッセージ
- **response-types 拡張パッケージ** — 共通型 (ApiError 等) の JSON Schema。`docs/sample-project/extensions/response-types.json` または `data/extensions/response-types.json` に定義する
- **externalSystemCatalog** — 外部 API (stripe 等) の baseUrl / auth / timeout
- **secretsCatalog** — API キー等のメタデータ (`@secret.stripeKey` で参照、値は含まない)
- **ambientVariables** — ミドルウェア由来変数 (`@requestId` 等) の宣言

## 5. 検証 (警告パネル)

画面右上の「N 警告」バッジをクリックで詳細パネルが開く。以下のバリデータが走る:

- **参照整合性** (referentialIntegrity) — responseRef / errorCode / systemRef / typeRef / secretRef の未定義参照
- **@identifier スコープ** (identifierScope) — inputs / outputBinding / ambient / ループ変数との突合
- **SQL 列** (sqlColumnValidator) — DbAccessStep.sql の列がテーブル定義にあるか
- **@conv.* 参照** (conventionsValidator) — 規約カタログのキーに存在するか

各警告の行の「AI に依頼」ボタンで、kind=todo の marker が 1-click 起票される。パネル上の「全て AI に依頼」で一括起票も可能。

## 6-9. AI 往復 (詳しくは [marker-workflow.md](marker-workflow.md))

## 10-13. 下流モード切替と実装引き渡し

- モード切替ボタンで `downstream` に
- MarkerPanel / 警告バッジが clean (0 未解決 / 0 警告) になるまで詰める
- `npm run validate:samples -- ../examples/<project-id>` で最終確認 (AGENTS.md 記載のコマンド)
- この JSON を別 AI セッション (実装担当) に渡して実装開始

## 成熟度 (maturity) の目安

| maturity | 状態 | 何を意味するか |
|----------|------|---------------|
| `draft` | 下書き | 頻繁に変わる。外部に出さない |
| `provisional` | 暫定 | AI 依頼中 / レビュー中 |
| `committed` | 確定 | 下流に渡して良い。以降は保守的に編集 |

ProcessFlow / action / step の 3 粒度で設定可。step が committed なら、`/designer-work` は編集を保留 (人間承認待ち) する。

## AI 実装者が設計書を読む順序

処理フロー JSON を渡されて実装する AI は以下の順で読む:

1. **`data/conventions/catalog.json`** — project-wide defaults (通貨・タイムゾーン・税率・認証・DB 規約等)。`default: true` のエントリが全フローの ambient 前提
2. **対象 ProcessFlow の `ambientOverrides`** — このフローだけの特例 (無い場合は 1. の defaults をそのまま適用)
3. **処理フロー本体** (actions / steps) — 具体ロジック
4. **テーブル定義 (DDL)** — 採番ロジック等のインフラ層
5. **画面項目定義** — 入出力の UI 制約

詳細: [`docs/spec/process-flow-runtime-conventions.md §9`](../spec/process-flow-runtime-conventions.md)

## 関連ドキュメント

- 仕様: [`docs/spec/process-flow-extensions.md`](../spec/process-flow-extensions.md)
- 式言語: [`docs/spec/process-flow-expression-language.md`](../spec/process-flow-expression-language.md)
- 実行時規約: [`docs/spec/process-flow-runtime-conventions.md`](../spec/process-flow-runtime-conventions.md)
- JSON Schema: [`schemas/process-flow.schema.json`](../../schemas/process-flow.schema.json)
