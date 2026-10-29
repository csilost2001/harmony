---
description: "コードの地図: 用語・機能 → 実装のファイル。実装を読む・直すときの入口 (パスは npm run check:docs が実在を検査する)"
---

# コードの地図

実装を読む・直す AI のための、用語 → ファイルの対応。設計 (JSON) を読み書きするだけなら、[AI-INDEX.md](AI-INDEX.md) の tool で足りる。**パスは検査される** (実在しなくなると `npm run check:docs` が止める)。

## 構成

| 場所 | 役割 |
|---|---|
| `shared/src/` | frontend と backend が共有する、**画面なしで動く計算**: 設計書の組み立て・分析・判定表・「流れ」の言葉・取り込み・検証。試験は frontend 側に置く (shared には試験の実行がない) |
| `backend/src/` | MCP + WebSocket の常駐サーバ (port 5179)。設計ファイルの読み書き・編集セッション・運用の記録 |
| `frontend/src/` | React の画面。設計を編集・閲覧する |
| `schemas/v3/` | 設計の JSON Schema (一次成果物。設計者の専権) |
| `ai-skills/` | AI の手順 (スキル)。MCP の Prompts としても出る |
| `examples/` | サンプルのプロジェクト。近い業務の例を読む (`examples/PATTERNS.md`) |

## 設計データの点検

| 機能 | ファイル |
|---|---|
| 設計どうしの参照の整合 (x-ref-kind の宣言から) | `shared/src/analysis/integrity.ts` / `shared/src/analysis/refKinds.generated.ts` |
| 状態遷移・初期データ・要件・ジョブの点検 | `shared/src/analysis/genericChecks.ts` |
| 初期データの書き出し (INSERT 文 / JSON) / 状態遷移図 (Mermaid) | `shared/src/seedExport.ts` / `shared/src/diagrams.ts` |
| 汎用定義の編集画面 (種類ごとの入力欄) | `frontend/src/components/generic-definition/KindSections.tsx` |

## MCP (AI の入口)

| 機能 | ファイル |
|---|---|
| tool の定義 | `backend/src/tools.ts` |
| サーバの組み立て (振り分け・Resources・Prompts・プロファイル・注釈) | `backend/src/mcpServer.ts` |
| tool の実装 (種類ごと) | `backend/src/handlers/` (どの tool がどのファイルかは `backend/src/handlers/README.md`) |
| Resources / Prompts / 接続時の案内 | `backend/src/mcpKnowledge.ts` |
| 設計全体の要約 (`get_project_context`) | `backend/src/projectContext.ts` |
| 読み取り専用・拒否・プロファイル | `backend/src/security/mcpAccess.ts` `backend/src/security/mcpProfiles.ts` |
| tool の注釈・短い説明・エラーの直し方 | `backend/src/mcpToolMeta.ts` |
| AI の書き込みの監査ログ | `backend/src/ops/auditMap.ts` `shared/src/ops/auditTools.ts` |

## 設計の保存

| 機能 | ファイル |
|---|---|
| ファイルの読み書き (画面・テーブル・処理フロー・汎用定義 など) | `backend/src/projectStorage.ts` `backend/src/storageCore.ts` |
| 設計全体を設計書の入力にまとめる | `backend/src/designInput.ts` |
| 登録簿 (harmony.json) と登録されていない設計の補完 | `backend/src/registryMerge.ts` |
| 編集セッション (下書き・排他) | `backend/src/editSessionStore.ts` `backend/src/wsBridge/editSessionService.ts` |
| 保存前の版・外部変更の検知・健全性 | `backend/src/fileVersions.ts` `backend/src/externalChanges.ts` `backend/src/workspaceHealth.ts` |
| 改名・参照の付け替え・参照元 | `backend/src/renameEntity.ts` `backend/src/designReplace.ts` `backend/src/references.ts` |

## 処理フロー

| 機能 | ファイル |
|---|---|
| スキーマ | `schemas/v3/process-flow.v3.schema.json` |
| 型 | `frontend/src/types/v3/process-flow.ts` |
| 工程の編集 (追加・更新・移動・入れ子) | `backend/src/processFlowEdits.ts` |
| 処理記述表・アウトライン・テスト観点・図の配置 | `shared/src/flowStructure.ts` |
| 条件の言葉への変換・変数の名前 | `shared/src/flowWords.ts` |
| 判定表の計算 (分岐を条件 × 道の表に) | `shared/src/flowDecision.ts` |
| 「流れ」表示 (画面) | `frontend/src/components/process-flow/story/ProcessFlowStory.tsx` |
| カード / 表 / 図の編集画面 | `frontend/src/components/process-flow/ProcessFlowEditor.tsx` |
| 式の検査・識別子の範囲 | `frontend/src/schemas/identifierScope.ts` |

## 設計の分析・書き出し

| 機能 | ファイル |
|---|---|
| 設計書 (HTML / 要確認) | `shared/src/designDocument.ts` |
| 影響分析・未使用・用語・命名・進捗・SQL の一覧 | `shared/src/analysis/` |
| テスト観点表 | `shared/src/testViewpoints.ts` |
| DDL / OpenAPI / Excel の取り込み | `shared/src/importers/` |
| Word / Excel の書き出し | `shared/src/export/` |
| 点検の設定 (抑制・独自ルール) | `backend/src/designCheckSettings.ts` |

## 画面 (frontend)

| 機能 | ファイル |
|---|---|
| 画面の経路・タブ | `frontend/src/components/AppShell.tsx` |
| 業務部品デザイナ (画面) | `frontend/src/components/screen-layout/` `shared/src/screenLayout.ts` |
| テーブル編集・ER 図 | `frontend/src/components/table/` |
| 設計書ビュー | `frontend/src/components/document/` |
| 設計の分析ビュー | `frontend/src/components/analysis/` |
| 画面の色 (唯一の定義) | `frontend/src/styles/tokens.css` |
