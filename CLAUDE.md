# CLAUDE.md

Claude Code 向けの補足ガイダンス。

**プロジェクト全般のルールは [AGENTS.md](./AGENTS.md) を参照してください** (Codex CLI 等の他 AI コーディングエージェントも同ファイルを読みます)。以下は Claude Code 固有の事項のみ記載します。

@AGENTS.md

---

## Claude Code 固有の環境

### MCP 接続

- `.mcp.json` の URL エントリ経由で `backend` に自動接続 (port 5179)
- 起動前提: `cd backend && npm run dev` で常駐済みであること
- 接続先: `http://localhost:5179/mcp`

### Slash Commands / Skills

本プロジェクトで利用する Claude Code 固有スキル (`.claude/skills/`):

- **`/issues <N>`** — ISSUE を 12 ルール Opus オーケストレーターワークフローで完遂 (`.claude/skills/issues/SKILL.md`)
- **`/review-pr <N>`** — PR 独立レビュー (一般品質: spec / 命名 / テスト) (`.claude/skills/review-pr/SKILL.md`)
- **`/create-flow <flowId> <業務概要> [namespace]`** — ProcessFlow JSON を品質ガード付きで作成 (`/review-flow` の 10 観点を作成前 self-check として組み込み、18 ルールの既知パターン回避 self-check を含む)。`/review-flow` と併用前提 (`.claude/skills/create-flow/SKILL.md`)
- **`/review-flow <flowId>`** — ProcessFlow JSON 実行セマンティクス専門レビュー (変数ライフサイクル / TX / runIf / 補償 / event 双方向)。設計フェーズから使える (`.claude/skills/review-flow/SKILL.md`)
- **`/review-issue <N>`** — ISSUE 単位の実装網羅性監査 (`.claude/skills/review-issue/SKILL.md`)
- **`/test-strategy`** — テスト実装時の自動起動スキル (`.claude/skills/test-strategy/SKILL.md`)
- **`/rename-screen-ids`** — AI 推論による画面項目 ID 再命名 (`.claude/skills/rename-screen-ids/SKILL.md`)
- **`/generate-code <flowId|screenId> [出力先]`** — project.techStack に基づき ProcessFlow → backend code / Screen → frontend code を生成。Spring Boot/Thymeleaf 系と NestJS/Next.js 系の 2 種類の techStack 組合せをカバー (`.claude/skills/generate-code/SKILL.md`)
- **`/generate-tests <flowId|screenId> [出力先]`** — ProcessFlow → backend e2e test (jest+supertest) / Screen → component test (vitest+testing-library) / multi-screen → playwright E2E / AI flow → mock+実 API 切替テストを spec から機械導出。`/generate-code` の対 (`.claude/skills/generate-tests/SKILL.md`)

Codex CLI 利用時はこれらのスキルは直接呼び出せません。等価機能は Codex plugin の `/codex:review` 等で代替するか、Opus が briefing で代替指示を出します。

### ワークスペース機能

複数ワークスペース管理機能の仕様は [docs/spec/workspace.md](docs/spec/workspace.md) を参照。`backend` は **active workspace** 1 つに対応し、env `DESIGNER_DATA_DIR` が指定されている場合は lockdown モードで固定される (recent への読み書きなし)。

複数ワークスペースの**同時並行編集** (v2) は [docs/spec/workspace-multi.md](docs/spec/workspace-multi.md) を参照 (#679 シリーズ)。

### Schema ガバナンス (最重要、#511)

`schemas/process-flow.schema.json` / `schemas/extensions-*.schema.json` / `schemas/conventions.schema.json` 等の **グローバル定義スキーマは、フレームワーク製作者 (設計者) の専権事項**。

- AI (Sonnet/Codex/Opus 含む) が**勝手に変更するのは禁止** (権限外行為)
- 業務記述で表現できない場合は:
  1. 拡張機構 (`extensions/<namespace>/*.json`) で代替できないか確認
  2. 既存 schema フィールドで代替表現できないか確認 (`type: "other"` + outputSchema パターン等)
  3. それでも無理なら **ISSUE 起票して作業停止**、設計者承認待ち
- テスト pass を理由に schema を勝手に拡張するのは**絶対禁止**

詳細: memory `feedback_schema_governance_strict.md` / `docs/spec/schema-governance.md`

`/issues` オーケストレーターは PR 作成後に `gh pr diff <PR> -- schemas/` で必ずチェックし、紐付かない変更を検出した場合は revert もしくは別 ISSUE 起票で隔離する。

### draft-state policy (設計途中許容)

業務リソースの保存は schema 違反があっても許可し、UI 側で違反や未完成項目を error / warning として可視化する。5 原則・severity 判定基準・新規リソース追加 checklist は [`docs/spec/draft-state-policy.md`](docs/spec/draft-state-policy.md) を参照すること。

### ドッグフード deploy 先

AI ドッグフード時のサンプル展開先は **`workspaces/dogfood-<目的-YYYYMMDD>/`** を使用する。`data/` への deploy は禁止 (`data/` はデザイナー本体組み込み拡張定義 `data/extensions/` 専用、#753 で責務縮退済み)。`examples/<project-id>/` を作業領域にコピーする際も `workspaces/<project-id>/` を使う。

```bash
# examples/retail/ を dogfood 領域にコピーする例 (Windows PowerShell)
Copy-Item -Recurse -Force examples\retail\* workspaces\retail\
```

### edit-session-draft (サーバ側 draft 管理モデル)

全エディタを明示保存式に統一し、編集中の作業コピーをサーバ側ファイルシステム (`data/.drafts/<wsId>/`) に保持するモデル。ロック排他制御・AI 連携 (`onBehalfOfSession`) を含む。仕様書: [`docs/spec/edit-session-draft.md`](docs/spec/edit-session-draft.md) (#683 / #684)

### Memory システム

- 自動メモリは Claude Code が `~/.claude/projects/<encoded-project-path>/memory/` に自動保存 (per-user / per-machine、git 管理外)
- `MEMORY.md` が index、個別ファイルは `feedback_*.md` / `project_*.md` / `reference_*.md` 等の命名規約
- Codex 経由のタスクでは memory は自動共有されないため、必要な文脈は Opus が briefing に転記する
- **Claude Code クラウド版** はセッション毎に ephemeral コンテナで起動するため、`~/.claude/projects/...` の memory は **当該セッション限り** で別セッションに引き継がれない。クロスセッションで共有したい知見は本 `CLAUDE.md` / `AGENTS.md` / `docs/` に commit すること

### Claude Code クラウド版固有の制約

クラウド版 Claude Code (claude.ai/code) は git proxy 経由で push する。proxy は **destination branch の allowlist** を enforce しており、各セッションは以下にのみ push 可:

- 自身の **designated branch** (system prompt で指定される `claude/<...>`)
- **`feat/test-push-*`** パターン (任意 suffix、staging 用)

他セッションの designated branch (例: 別セッションが担当する `feat/e2e-coverage-series`) への直接 push は **HTTP 403 (RPC failed)** で拒否される。エラーメッセージは reason header を含まないため、原因究明に時間を浪費しがち。

#### 標準回避策

統合ブランチ (例: シリーズ PR の `feat/<topic>-series`) に commit を積みたい場合:

```bash
# ローカルで本来の branch に commit を積む
git checkout feat/<topic>-series
git commit ...

# feat/test-push-<discriminator> に staging push (proxy 通過)
git push origin feat/<topic>-series:feat/test-push-<issue>-<topic>

# 後続セッション (designated = feat/... 系) または ユーザーが本来のブランチに promote
# (= fast-forward push or merge)
```

**discriminator** には ISSUE 番号や日付など、他セッションと衝突しない一意な suffix を付ける (例: `feat/test-push-934-coverage`)。

#### NG パターン (避けること)

- ❌ designated branch (`claude/...`) への cherry-pick で妥協 — 別セッションが pull/merge する際に commit hash 不一致で履歴混乱
- ❌ 同 destination 名で source ref を変えてリトライ — proxy は destination で拒否、source 変更は無効
- ❌ proxy port 変化を待ってリトライ — port が変わっても allowlist は同じ

詳細・切り分け手順・実例は memory `feedback_cloud_proxy_push_restriction.md` (クラウド版では git に無いため、未経験セッションは本節のみで対応)。

ローカル CLI 版 (PC で起動した Claude Code) には **この制限は無い**。クラウド版固有。

### 命名運用中の重要事項

- `ProcessFlow` → `ProcessFlow` への大規模リネームを計画中 (2026-04-25 決定)
- 詳細は memory `project_framework_research_2026_04_25.md` を参照
- リネーム完了まで当面は混在表記あり

### Codex plugin 連携 (2026-04-25 以降導入)

本プロジェクトでは **Codex plugin 経由で GPT-5.5 にタスク委譲** する運用を試行中。詳細は memory `project_framework_research_2026_04_25.md` を参照。

- 実装委譲: `/codex:rescue <task description>`
- 一次レビュー: `/codex:review`
- 挑発的レビュー: `/codex:adversarial-review`
- プロジェクト固有設定: `.codex/config.toml` を配置可能 (推奨モデル / reasoning effort 等)
