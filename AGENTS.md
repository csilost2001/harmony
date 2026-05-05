# AGENTS.md

このファイルは、本リポジトリを扱う AI コーディングエージェント (Claude Code / Codex CLI 等) に共通のプロジェクトガイダンスを提供します。

Claude Code 固有の補足は `CLAUDE.md`、Codex 固有の設定は `.codex/config.toml` (配置時) を参照してください。

## ISSUE 起票の鉄則 (最重要、絶対遵守、全 AI)

**1 人で 100〜200 / 日のペースで増える open ISSUE を回している。気軽な分離は チーム運用を破壊する。**

### 鉄則 (例外なし)

1. **デフォルトは「起票しない」**。`gh issue create` を打つ前に必ず以下を順に検討し、3 つすべて不可と判断した時に **初めて** 起票候補:
   - 本 PR で同 commit / 同 description に吸収できないか (1-3 時間以内なら吸収)
   - 後続の親 / 子 ISSUE のスコープに自然に入らないか
   - PR description / commit message / memory にメモするだけで trace 目的を達成できないか
2. **ISSUE 対応中に別 ISSUE を切って逃げるな**。発見した課題は同 PR で吸収するか、PR description に「将来課題」として記録する。**ISSUE 化は最終手段**
3. **同根の複数提案は必ず 1 ISSUE に統合**。同じ schema / 同じ spec / 同じ領域 / 同根の発見イベント (同 PR / 同 dogfood / 同調査) から出てきた提案は 1 ISSUE 内に sub-section (## 提案 A / B / C) で列挙する

### 別 ISSUE 化が **明確に妥当** な条件 (これら以外は禁止)

以下の **明確な根拠** が示せる場合のみ起票:

1. **完全に別機能側のバグ / 改善** — 現在対応中の機能 / 領域と無関係
2. **フレームワーク全体の再設計が必要** — 1 PR では収まらない設計判断を要する
3. **かなり大規模** — 数日〜週単位の独立工数を要する
4. **別チームへの依頼** — 本リポジトリ外を含む

### 禁止された逃げ口の理由付け

以下の理由は **すべて禁止**:

- ❌ 「schema governance により AI 単独実装禁止だから別 ISSUE 化」 — schema 提案も同 PR description / 統合 ISSUE に書けば良い
- ❌ 「scope 厳守のため別 ISSUE」 — 同根なら scope 内
- ❌ 「念のため別 ISSUE で隔離」 — ISSUE 純増コストが大きい
- ❌ 「pre-existing 問題なので別 ISSUE」 — 同ファイル / 同画面なら同 PR 吸収
- ❌ 「将来対応のため記録」 — PR description / commit message / memory で足りる

### 起票直前の self-check (義務)

`gh issue create` を打つ **直前** に 5 項目すべて ✓ を確認:

1. ☐ 鉄則 1: 本 PR / 後続 ISSUE / description / memory で吸収不可な明確な根拠を提示できる
2. ☐ 鉄則 2: 現在 PR 対応中なら本 PR で吸収する選択肢を本気で検討した
3. ☐ 鉄則 3: 他に同根の起票候補があるなら 1 ISSUE に統合する用意がある
4. ☐ 妥当条件 (別機能 / 再設計 / 大規模 / 別チーム) のいずれかに **明確に** 該当する
5. ☐ 「禁止された逃げ口」を理由にしていない

1 つでも疑問が残るなら **起票しない**。

### 失敗事例 (再発防止のため記録)

- 2026-05-04 PR #780: 同根の framework 提案 3 件を #781/#782/#783 と別々に起票 → 2 件純増。同 schema (`schemas/v3/process-flow.v3.schema.json`) を触る同根提案は 1 ISSUE に統合すべきだった

### 関連 memory (起票判断時に必読)

- `feedback_issue_split_criteria.md` (canonical 判定基準)
- `feedback_issue_split_hidden_costs.md` (トークン累積 + main 滞留コスト)
- `feedback_consolidate_related_proposals_into_one_issue.md` (鉄則 3 の具体例)
- `feedback_pr_scope_absorb_pre_existing.md` (pre-existing は同 PR 吸収)
- `feedback_pr_granularity.md` (PR を過度に細かく分けない)

## Project Overview

業務システム デザイナー — Japanese business application WYSIWYG screen designer. Two main components:

- **designer/** — Frontend (React + Vite + GrapesJS + ReactFlow)
- **designer-mcp/** — MCP server + WebSocket bridge for file persistence

## Schema ガバナンス (最重要、#511 — 全 AI が遵守)

`schemas/process-flow.schema.json` / `schemas/extensions-*.schema.json` / `schemas/conventions.schema.json` 等の **グローバル定義スキーマは、フレームワーク製作者 (設計者) の専権事項**。

- **AI (Claude/Codex/その他) が勝手に変更するのは禁止** — 権限外行為、フレームワークの統一性を損なう
- 業務記述で表現できない場合の対処順序:
  1. 拡張機構 (`examples/<project-id>/extensions/<namespace>/*.json` または `workspaces/<id>/extensions/<namespace>/*.json`) で代替できないか確認
  2. 既存 schema フィールドで代替表現できないか確認 (`type: "other"` + outputSchema パターン等)
  3. それでも無理なら **ISSUE 起票して作業停止**、設計者承認待ち
- **テスト pass を理由に schema を勝手に拡張するのは絶対禁止**

詳細仕様: [`docs/spec/schema-governance.md`](docs/spec/schema-governance.md)

PR 作成後 / マージ前に `git diff origin/main..HEAD -- schemas/` を必ず確認すること。

## draft-state policy (設計途中許容 + 警告可視化)

業務リソースは設計途中の draft-state でも保存可能とする。schema 違反や未完成項目は保存ブロッカーにせず、UI の一覧・カード・編集画面で error / warning として可視化し、`committed` maturity へ進める過程で解消する。

5 原則・severity 判定基準・新規リソース追加 checklist は [`docs/spec/draft-state-policy.md`](docs/spec/draft-state-policy.md) を参照すること。新しいリソース種別を追加する AI エージェントは、同 checklist に従って validator / store / ListView / Editor / maturity 表示 / AJV test layer の扱いを確認すること。

## edit-session-draft (サーバ側 draft 管理モデル)

全エディタを明示保存式に統一し、編集中の作業コピーをサーバ側ファイルシステム (`data/.drafts/`) に保持するモデル。ロック排他制御・AI 連携 (`onBehalfOfSession`) を含む。仕様書: [`docs/spec/edit-session-draft.md`](docs/spec/edit-session-draft.md) (#683 / #684)

## Commands

### Designer (Frontend)

```bash
cd designer
npm install        # Install dependencies
npm run dev        # Dev server (http://localhost:5173)
npm run build      # TypeScript check + Vite build
npm run lint       # ESLint
```

### Designer-MCP (Backend)

```bash
cd designer-mcp
npm install
npm run dev        # Watch mode (tsx)
npm run build      # Compile to dist/
```

Both servers must run simultaneously for file-based persistence. Without designer-mcp, the frontend falls back to localStorage.

`designer-mcp` は常駐サーバ (#302): `cd designer-mcp && npm run dev` で 1 回起動すれば、ブラウザ・複数の AI エージェントセッション双方が接続できる。エージェント終了でも停止しないので、次回以降も使い回し可能。

### ドッグフード deploy 先

AI ドッグフード時のサンプル展開先は **`workspaces/dogfood-<目的-YYYYMMDD>/`** を使用する。`data/` への deploy は禁止 (`data/` はデザイナー本体組み込み拡張定義 `data/extensions/` 専用、#753 で責務縮退済み)。`examples/<project-id>/` を作業領域にコピーする際も `workspaces/<project-id>/` を使う。

```bash
# examples/retail/ を dogfood 領域にコピーする例 (Windows PowerShell)
Copy-Item -Recurse -Force examples\retail\* workspaces\retail\
```

## 一時ファイル・作業ファイルの配置ルール (全 AI 必須)

**プロジェクトルートへの直接ファイル作成は禁止。** `.gitignore` で除外されていても、物理的散乱はルール違反。

| 種別 | 配置先 |
|------|--------|
| MCP スクリーンショット (Playwright / chrome-devtools) | `.tmp/screenshots/` |
| AI 中間作業ファイル (handoff notes / dogfood レポート等) | `.tmp/` |
| スキル出力 (`/review-pr` / `/review-issue` 等) | `tmp/review-cache/` |
| ログファイル | `logs/` |
| Playwright / Vitest テスト成果物 | `test-results/` または `designer/test-results/` |

### 禁止事項

- ❌ プロジェクトルートへの `.png` / `.log` / `.md` 一時ファイル直置き
- ❌ `screenshots/` をルート直下に作成する (`.tmp/screenshots/` を使う)
- ❌ 新規ファイルを `tmp/` に作成する — 新規は `.tmp/` に統一、`tmp/review-cache/` のみ既存例外

### スクリーンショット取得時の手順

`mcp__playwright__browser_take_screenshot` や `mcp__chrome-devtools__take_screenshot` を使う際:

1. ツールがパス指定をサポートする場合 → `.tmp/screenshots/<名前>.png` を明示指定
2. ツールがデフォルト出力先を使う場合 → 取得直後に PowerShell で移動:
   ```powershell
   Move-Item .\*.png .\.tmp\screenshots\
   ```

## Architecture

### Two-Process Design

```
AI Agent ──(http://localhost:5179/mcp)──┐
                                        ▼
                                   designer-mcp ←──(ws://0.0.0.0:5179)──→ Browser
                                        ▼
                          ┌─────────────────────────────┐
                          │  data/extensions/  (本体)   │  ← git tracked
                          │  workspaces/<id>/  (作業)   │  ← gitignored
                          └─────────────────────────────┘
```

- **MCP (HTTP Streamable, port 5179):** AI エージェントは MCP 設定 (Claude Code は `.mcp.json`、Codex は `.codex/config.toml`) で HTTP URL エントリ経由接続 (#302)。常駐サーバなので複数セッション同時接続可、orphan 問題も解消
- **WebSocket (port 5179):** Browser reads/writes screen data via wsBridge — MCP と同一 port に同居
- **Shared storage:** `data/extensions/` (デザイナー本体組み込み拡張定義、git tracked) + active workspace の `workspaces/<wsId>/` (ユーザープロジェクトデータ、gitignored)

### 起動

- **通常の開発フロー**: `cd designer-mcp && npm run dev` で常駐起動 (任意のタイミングで 1 回)。AI エージェントは同プロジェクトで開けば MCP 設定経由で自動接続。
- **自動 spawn はしない** (URL mode): エージェント起動時に既存サーバが無いと MCP 不接続状態になるため、backend が上がっているか先に確認すること。

### Routing

URL 規約: **`/category/feature[/:id]`** 形式（Java 風階層）。ルートは単一概念で意味が通るよう、複数解釈できる複数形は避ける（例: `/flow` は 画面フロー／処理フロー どちらか不明なため不採用）。

| Path | Component | Purpose | Opens as tab? |
|------|-----------|---------|---------------|
| `/` | DashboardView | 全体俯瞰ダッシュボード | ✅ singleton |
| `/screen/flow` | FlowEditor | 画面フロー図（ReactFlow、キャンバス固定）| ✅ singleton |
| `/screen/list` | ScreenListView | 画面一覧（カード ⇔ 表切替）| ✅ singleton |
| `/screen/design/:screenId` | Designer | 画面デザイナー（GrapesJS）| ✅ per-resource |
| `/table/list` | TableListView | テーブル一覧 | ✅ singleton |
| `/table/edit/:tableId` | TableEditor | テーブル編集 | ✅ per-resource |
| `/table/er` | ErDiagram | ER 図 | ✅ singleton |
| `/process-flow/list` | ProcessFlowListView | 処理フロー一覧 | ✅ singleton |
| `/extensions` | ExtensionsPanel | 拡張管理 | ✅ singleton |
| `/process-flow/edit/:processFlowId` | ProcessFlowEditor | 処理フロー編集 | ✅ per-resource |

ワークスペース概念 (active workspace / lockdown / recent / 切替プロトコル) は [docs/spec/workspace.md](docs/spec/workspace.md) を参照。複数ワークスペースの**同時並行編集** (v2) は [docs/spec/workspace-multi.md](docs/spec/workspace-multi.md) を参照 (#679 シリーズ)。

### Tab policy

**HeaderMenu から到達できる画面と、個別リソース編集画面は、すべてタブ。**

| 種別 | 対象 | 性質 |
|------|------|------|
| シングルトンタブ | Dashboard / 画面フロー / 画面一覧 / テーブル一覧 / ER 図 / 処理フロー一覧 / 拡張管理 | 1 インスタンス固定、再オープン時は既存を再利用 |
| マルチインスタンスタブ | Designer / TableEditor / ProcessFlowEditor | リソース ID 毎に独立タブ |
| route only | なし | — |

**理由**: 一覧画面は全機能の俯瞰・順序変更・検索・帳票出力等の中心機能で、**詳細より頻繁に開かれる**。タブ化しないと毎回 HeaderMenu から辿り直しで UX 劣化する。VS Code も Welcome / Settings / Source Control などシングルトンをタブで開く。

**旧ポリシー（#98）は撤回**: 「一覧は通過点だから route only」という判断は、実際の使用頻度と衝突するため破棄。

### Key Directories

- `designer/src/components/flow/` — Flow diagram editor (ReactFlow-based)
- `designer/src/grapes/blocks.ts` — 60+ pre-built block definitions
- `designer/src/store/` — Persistence layer (flowStore, customBlockStore)
- `designer/src/mcp/mcpBridge.ts` — Browser-side WebSocket client
- `designer-mcp/src/tools.ts` — 20 MCP tool definitions
- `designer-mcp/src/wsBridge.ts` — WebSocket server + broadcast

### Data Flow

- **Save:** GrapesJS autosave → remoteStorage → mcpBridge (WS) → wsBridge → active workspace の `screens/{id}.json` (path は active workspace 依存)
- **Fallback:** If WS disconnected → localStorage (`gjs-screen-{id}`)
- **Sync:** wsBridge broadcasts changes to all connected browser tabs

## Environment Notes

- **Windows:** `npx` may fail in Git Bash. Ensure Node.js is in PATH.
- **gh CLI:** Added to PATH via `~/.bashrc`. No prefix needed — `gh` commands work directly.
- **Ports:** Vite on 5173 (strictPort), WebSocket on 5179. Both listen on 0.0.0.0.
- **HTTP access:** `crypto.randomUUID()` is unavailable in non-secure contexts. Use `generateUUID()` from `src/utils/uuid.ts` instead.
- **Playwright MCP:** Do not use `--headless=false` flag on Windows.

## Testing Strategy

- Vitest: `designer/src/**/*.test.ts` — ストアロジック・ユーティリティ
- Playwright: `designer/e2e/**/*.spec.ts` — UI・ナビゲーション操作
- MCP E2E: `designer/e2e/mcp/**/*.spec.ts` — wsBridge ファイル操作（要 designer-mcp 起動）

Claude Code 利用時は `/test-strategy` スキルが自動起動 (詳細は `CLAUDE.md` 参照)。他 AI エージェントは同等原則を本節から参照。

## Process Flow (処理フロー) — 一次成果物は JSON Schema

処理フロー定義はこのプロジェクトの主出力 (AI が読んで実装する前提)。TypeScript 型は派生物、UI は最後尾の表示層。変更時の順序:

1. 仕様書 [`docs/spec/process-flow-*.md`](docs/spec/README.md)
2. JSON Schema [`schemas/process-flow.schema.json`](schemas/process-flow.schema.json)
3. TypeScript 型 `designer/src/types/action.ts`
4. UI / 実装

検証テスト: `examples/retail/process-flows/*.json` は `samples-v3.schema.test.ts` が担当。サンプル全体の runtime 契約検証は `npm run validate:samples -- ../examples/<project-id>` で実行。

**ユーザー向けワークフロー**: [`docs/user-guide/`](docs/user-guide/README.md) — 業務設計者が処理フローを書いて AI と往復する使い方。

**命名注意 (2026-04-25 決定)**: `ProcessFlow` を `ProcessFlow` にリネーム予定。移行中は両表記が混在する可能性あり。詳細はメモリ `project_framework_research_2026_04_25.md` (Claude Code memory) を参照。

## UI Conventions

詳細仕様は [docs/spec/](docs/spec/README.md) に集約。一覧系 UI を触る前に必ず読む:

- **一覧系 UI** (選択・キーボード・D&D・コピペ・ソート・フィルタ・Read-only モード・No 列永続フィールド): [docs/spec/list-common.md](docs/spec/list-common.md)
  - `DataList` / `useListSelection` / `useListKeyboard` / `useListClipboard` / `useListFilter` / `useListSort` / `<FilterBar>` / `<SortBar>` / `<ViewModeToggle>`
  - 対象画面: 画面一覧・テーブル一覧・処理フロー一覧・テーブル定義 > カラム一覧

## Conventions

- All UI text is in Japanese
- Commit messages use conventional commits in Japanese (e.g., `feat(flow):`, `fix(designer):`, `improve:`)
- **Workflow: デフォルトは 1 ISSUE = 1 ブランチ = 1 PR**。ただし以下は複数 ISSUE を 1 PR に束ねる (ISSUE = 作業指示単位 / PR = 1 論理的変更単位、両者は 1:1 とは限らない):
  - UX / 機能として一体 (単独で動かない・ユーザー体験が完結しない)
  - 調査の結果、関連バグ・関連修正と判明した
  - シリーズ起票された ISSUE 群で、起票時点で PR グルーピングが宣言されている
  - 同じ画面に対する複数 ISSUE の同時修正

  束ねる場合: PR description に **各 ISSUE の前に `Closes` キーワードを必ず書く** (GitHub 仕様 "Use full syntax for each issue")。改行区切り推奨:
  ```
  Closes #A
  Closes #B
  Closes #C
  ```
  **NG**: `Closes #A, #B, #C` は**先頭しか自動 close されない** (PR #340 で実例あり)。コミットは ISSUE 単位で分ける。独立レビューは**統合 PR 単位で 1 回**。Never commit directly to `main`. Branch naming: `feat/issue-<N>-<slug>` (単独 PR) / `feat/<topic-slug>` (統合 PR) for features, `fix/issue-<N>` or `fix/<slug>` for bug fixes, `docs/<slug>` for documentation-only changes. Create the branch from `origin/main` before starting work.
- PRs are squash-merged into `main`. The PR title should include the issue number (e.g., `feat(ui): ... (#83)`) so the merge commit references it.
- `data/` は本体専用 (`data/extensions/` のみ git tracked) + `workspaces/` がユーザー作業領域 (両方 gitignored)
- Themes: standard (default Bootstrap), card, compact, dark — CSS injected into GrapesJS canvas iframe
- Custom blocks persist to active workspace の `custom-blocks.json` via customBlockStore

## PR 作成・レビューの規約

運用手引き (人間向け): [docs/pr-review-workflow.md](docs/pr-review-workflow.md)

- PR 作成時は [`.github/pull_request_template.md`](.github/pull_request_template.md) を**全項目埋める**。不要な項目は削除せず「N/A」と明記 (レビュアーが見落としと区別するため)
- 「仕様逐条突合 (自己申告)」節は各条項を `file:line` で**個別に列挙**。「全条項 ✓」の一括表記は不可。大規模実装の完了報告前に仕様を逐条突合すること
- 大規模実装 / spec 絡み / UI 影響のある PR は、**別セッション (新しい会話)** で独立レビューを実行し、結果を PR コメントに投稿してからマージ判断する (Claude Code 利用時は `/review-pr <N>` スキル、Codex は `/codex:review`)
- **1 ISSUE を複数 PR に分割したケース**は、全 PR マージ後に ISSUE 単位の実装網羅性を監査する (Claude Code: `/review-issue <N>`)。PR 単位レビューでは検出できない実装漏れを拾う
- レビュー結果が Must-fix を含む場合はマージしない。Should-fix は AI が判断し、対応 or スコープ外として別 ISSUE 化
- **PR 単位 / 機能単位のユーザー確認は不要**。AI が build / test / UI smoke (chrome-devtools MCP / Playwright) / 独立レビュー / Must-fix 解決 / マージまで完遂する。ユーザー確認は**大規模改修一連の作業の最終リリース時のみ**

## シリーズ PR (統合 PR) 運用

ISSUE 本文の冒頭に `## 🔗 統合 PR 情報` セクションがある ISSUE は、**単独 PR ではなく統合 PR の一部** として実装する。実装者 (AI エージェント) は ISSUE 本文を読んだ時点で以下を自動実行する:

1. セクションに記載された **統合ブランチ** を `origin/main` (または指定 base) から切る (既に存在すれば checkout して継続)
2. 自分の担当 ISSUE 分のコミットをそのブランチに積む (ISSUE 単位で commit メッセージを分ける)
3. **他の統合対象 ISSUE が全て完了するまで PR を作らない** (draft も不可)
4. 最後の ISSUE 完了時に PR を作成、description に **各 ISSUE の前に `Closes` を必ず書いて** 全 ISSUE を列挙 (GitHub 仕様: 改行区切り推奨):
   ```
   Closes #A
   Closes #B
   Closes #C
   ```
   **NG**: `Closes #A, #B, #C` は先頭しか自動 close されない
5. 独立レビューは統合 PR 単位で 1 回のみ (個別 ISSUE で実行しない)。AI smoke test も統合 PR 単位で 1 回

ユーザーからの指示が `#<N> やって` のように単一 ISSUE 番号でも、本文に本セクションがあれば上記に従う。セクションが無い場合は通常の 1 ISSUE = 1 PR 運用。

**壁打ち担当 (設計者) は ISSUE 起票時**、UI 一体性 / 関連修正 / 同一画面 / 依存関係のある ISSUE 群は必ず統合 PR 化し、各 ISSUE 本文冒頭に本セクションを挿入する。

### 後付けで関連性が判明した場合 (起票時には無関係に見えた ISSUE)

テスター起票のバグや、他担当者が先行起票した ISSUE など、起票時点では関連性が不明なことは珍しくない。調査・実装の過程で他 ISSUE との共通点が判明した場合、以下で統合 PR 化する。

**実装者の着手前ルーチン (必須)**:

1. ユーザーから `#<N> やって` を受けた時点でまず `gh issue view <N>` で本文を読む
2. 本文に `## 🔗 統合 PR 情報` があればそれに従う (以上)
3. なければ、**着手前に必ず関連検索** する:
   - `gh issue list --state open --search "<キーワード>"` で同一機能領域の open ISSUE を洗う
   - 本 ISSUE が触りそうなファイル・モジュール・UI 画面名をキーワードに使う
   - 親 spec / 同一ディレクトリが対象の ISSUE も確認
4. 関連を発見した場合は **着手する前に** ユーザーに統合提案 (例: `「#<N> を調査したところ #<M> と同じ X を触ります。統合 PR にまとめていいですか?」`)
5. 承認後、全関連 ISSUE の本文冒頭に `## 🔗 統合 PR 情報` セクションを prepend (`gh issue edit --body-file`)。以後は通常の統合 PR 運用

**実装中に関連が判明した場合**:

- 作業を一時停止 (コミットは保持、push しない)
- 同じく統合提案 → 承認 → 本文更新
- 既に作業ブランチを切っていた場合は、ブランチ名を統合ブランチ名にリネーム (`git branch -m`) or checkout し直す

**壁打ち担当 (設計者) の新規起票時**:

- 起票前に `gh issue list --state open` で既存 open ISSUE を検索
- 関連があれば「新規起票 + 既存 ISSUE を統合 PR でまとめる」提案をユーザーに先に出す
- 承認後、新規 + 既存の全 ISSUE 本文に統合 PR 情報を追加

**統合 PR 化の判断基準 (いずれか該当で検討)**:

- 同じファイル / モジュール / UI 画面を触る
- 根本原因が共通 (1 fix で複数 ISSUE が解消する)
- 変更内容に依存関係がある (A が無いと B が動かない等)
- UX として一体で単独では動作評価できない

関連性が微妙な場合はユーザーに判断を委ねる。勝手に統合 / 単独を決めない。
