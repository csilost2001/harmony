---
name: issues
description: ISSUE を 12 ルール Opus オーケストレーターワークフローで完遂する (ISSUE 読み取り→設計→実装→レビュー→マージ)
argument-hint: <ISSUE番号>
disable-model-invocation: true
---

<!--
  使い方:
    `/issues 431` のように ISSUE 番号を指定して呼び出す。
    Opus がオーケストレーターとして以下の全工程を自律完遂する:
      ISSUE 読み取り → 統合 PR 判定 → 設計 → worktree 作成 →
      Codex/Sonnet 実装委譲 → Sonnet 独立レビュー → 修正 → squash マージ

  前提:
    - gh CLI がパスに通っていること
    - designer-mcp が起動していること (MCP ツールが必要な ISSUE の場合)
    - `disable-model-invocation: true`: ユーザーが明示的に `/issues <N>` と打った時のみ起動

  運用原則 (feedback_orchestration_workflow.md より):
    - Opus = オーケストレーター専任。実装コードは 1 行も書かない
    - 実装は worktree + Codex 優先 (失敗時 Sonnet フォールバック)
    - レビューは review-pr-sonnet サブエージェント
    - ユーザー介入なし。build/test/review/merge まで AI が完遂
-->

ISSUE #$ARGUMENTS を 12 ルール Opus オーケストレーターワークフローで解決します。

## Step 0: ISSUE を読む

`gh issue view $ARGUMENTS` で本文・コメント・ラベル・担当者・マイルストーンを全取得する。

## Step 1: 統合 PR 判定

ISSUE 本文に `## 🔗 統合 PR 情報` セクションがあるか確認:

### 統合 PR あり

セクション記載の統合ブランチ名を読む。

- ブランチが未作成 → `git worktree add C:/tmp/wt-$ARGUMENTS -b <統合ブランチ名> origin/main`
- ブランチが既存 → `git worktree add C:/tmp/wt-$ARGUMENTS <統合ブランチ名>` で checkout
- 自分の担当 ISSUE 分のコミットをそのブランチに積む (ISSUE 単位でコミットを分ける)
- **他の統合対象 ISSUE が全て完了するまで PR を作らない** (draft も不可)
- 最後の ISSUE 完了時だけ PR を作成し、description に `Closes #A\nCloses #B\n...` を記載

### 統合 PR なし → 関連 ISSUE 検索 (必須)

着手前に以下で関連 open ISSUE を洗い出す:

```bash
gh issue list --state open --search "<本 ISSUE のキーワード>"
```

本 ISSUE が触りそうなファイル・モジュール・UI 画面名をキーワードに使う。

- 関連発見 → **着手前に統合提案をユーザーへ**。承認後、全 ISSUE 本文に `## 🔗 統合 PR 情報` を prepend
- 関連なし → 通常の 1 ISSUE = 1 PR フロー (以降の Step へ)

## Step 2: 設計を ISSUE に先書き (Rule 5)

実装手順・変更ファイル・影響範囲を組み立て、**実装開始前に** `gh issue comment $ARGUMENTS --body "..."` で ISSUE に追記する。

この comment が:
- Codex/Sonnet への briefing
- 後のレビュー基準

## Step 3: ブランチと worktree を作る

```bash
git worktree add C:/tmp/wt-$ARGUMENTS -b feat/issue-$ARGUMENTS-<slug> origin/main
```

slug は ISSUE タイトルから英小文字ケバブケースで生成。

## Step 4: 実装を委譲 (Rule 6)

### 第一手: Codex

```
Agent(subagent_type="codex:codex-rescue", prompt="--fresh\n\n<briefing>")
```

briefing には以下を含める:
- ISSUE 番号・タイトル・本文
- Step 2 で書いた設計手順
- 作業ディレクトリ: `C:/tmp/wt-$ARGUMENTS`
- PR 作成まで完了すること
- **`schemas/*.json` (グローバル定義スキーマ) 変更は AI の権限外。Codex/Sonnet/Opus は変更してはならない (#511、最重要)**:
  > 「`schemas/process-flow.schema.json` 等のグローバル定義スキーマは変更禁止。表現できない場合は ISSUE 起票して作業停止、設計者承認待ち。テスト pass を理由に勝手に拡張するのは絶対禁止 (memory `feedback_schema_governance_strict.md` 参照)。」
- **ProcessFlow JSON 作成を含む ISSUE では `/create-flow` の 15 ルール self-check を遵守する旨を明示**:
  > 「フロー作成にあたり `.claude/skills/create-flow/SKILL.md` の Step 3 既知パターン回避 self-check 15 ルールを遵守すること:
  > **基本 8 ルール**: 1) TX 内 step が TX 外設定変数を前方参照しない、2) 外部呼び出しは TX 外、3) UPSERT 後の step すべてに同条件 runIf + no-op return、
  > 4) branch return 後の共通 step に fallthrough しない、5) compensatesFor 対象 step が実在、6) eventsCatalog ⇄ eventPublish 双方向整合、
  > 7) 外部呼び出しは TransactionScope inner にいない、8) rollbackOn は TX inner で発生するエラーコードのみ列挙 (死コード禁止)、
  > **追加 6 ルール (#486 検証で発覚)**: 9) SQL SELECT カラム整合 (後続参照の全フィールドが SELECT 句に含まれること)、
  > 10) `@conv.*` 参照は conventions-catalog.json 登録済キーのみ、11) TX 内 branch return 後の fallthrough も避ける、
  > 12) `affectedRowsCheck.operator` は `=` のみ (`==` 不可)、13) `affectedRowsCheck.expected` は integer リテラル必須、
  > 14) `OtherStep.outputSchema` は `{field: \"string\"}` 形式のみ、
  > **追加 1 ルール (#511 で導入、最重要)**: 15) グローバル schema (`schemas/*.json`) を変更禁止、必要なら ISSUE 起票して停止」

### Codex が「プラン制限」エラー → 即 Sonnet フォールバック

```
Agent(subagent_type="general-purpose", model="sonnet", prompt="...")
```

同じ briefing を渡す。

**⚠️ 確認なしで最初から Sonnet を使うのは禁止 (Rule 6 違反)**

## Step 4.5: マルチエディタ対応確認 (#806)

PR diff に画面関連ファイル (`screens/` / `Designer.tsx` / `PuckBackend` 等) が含まれる場合:

1. **editorKind / cssFramework 解決順序の確認**: screen → project → default の 3 段解決が一貫しているか
   - `screen.design.editorKind` → `project.techStack.designer.editorKind` → `"grapesjs"` のフォールバック (#826 で `project.design` から移行)
   - `screen.design.cssFramework` → `project.techStack.designer.cssFramework` → `"bootstrap"` のフォールバック (#826 で `project.design` から移行)
2. **Thymeleaf 出力スクリプトが Puck 画面をスキップしているか**: `editorKind === "puck"` 画面を Thymeleaf 出力対象から除外し、スキップした画面名をレポートに記録しているか確認
3. **動的コンポーネント primitive の確認**: 登録されるカスタムコンポーネントの `primitive` フィールドが `BUILTIN_PRIMITIVE_NAMES` に含まれる既知の名前かどうか

詳細仕様: `docs/spec/multi-editor-puck.md` § 2.3 / § 4.1

## Step 5.0: schema 変更チェック (最優先、#511 で導入)

**最重要**: `gh pr diff <PR番号> -- schemas/` で schema 変更の有無を確認:

```bash
gh pr diff <PR番号> --name-only | grep -E "^schemas/"
```

`schemas/*.json` (process-flow / extensions / conventions) に変更がある場合:

1. **設計者承認 ISSUE が紐付いているか確認** (PR description / 元 ISSUE で明示的に schema 改修を依頼している場合のみ正当)
2. **紐付かない schema 変更 = 権限外行為** (memory `feedback_schema_governance_strict.md` 参照):
   - **即座に Codex/Sonnet に revert 指示** (本来の修正は schema を触らずにやり直し)
   - もしくは **別 ISSUE 起票** で schema 変更を隔離 (例: `improve(schema): <フィールド名> 追加検討 — 経緯`)
   - schema 変更を含む PR は設計者承認が出るまでマージ禁止
3. テスト pass を理由にそのまま通すのは**絶対禁止**

検出された場合は ISSUE コメントで報告:
```bash
gh issue comment $ARGUMENTS --body "⚠️ schema 変更検出: <ファイル名> — 設計者承認が必要"
```

→ schema 変更なしを確認後、Step 5 へ。

## Step 5: 逸脱確認 (Rule 7)

`gh pr diff <PR番号> --name-only` と PR diff を読み、Step 2 の設計との乖離を確認:

- ファイル名・API・型レベルの乖離に注目
- 逸脱あり → `gh issue comment $ARGUMENTS --body "逸脱内容..."` に記録し、Codex/Sonnet に修正指示 → Step 5 に戻る (Rule 8)
- 逸脱なし → Step 5.5 へ

## Step 5.5: ProcessFlow 実行セマンティクス検証 (条件付き)

PR diff の **`examples/<project-id>/actions/*.json` または `data/process-flows/*.json`** に変更があれば、`/review-flow` を呼んで実行可能性を専門レビュー:

```
Skill(skill="review-flow", args="<flowId or path>")
```

または対象が複数なら:

```
Skill(skill="review-flow", args="--all")
```

**目的**: JSON Schema valid だが実行時にバグる問題 (変数前方参照・TX スコープ違反・runIf 抜け・branch dead-end 等) を **PR レビュー前** に潰す。これにより Step 6 の往復が激減する。

- Must-fix あり → Codex に修正指示 (Step 4 と同様 `--fresh`) → Step 5 に戻る
- Must-fix なし → Step 6 へ

**ProcessFlow JSON 変更がない PR ではこの Step を完全スキップ**。

## Step 6: 独立レビュー (Rule 9)

```
Agent(subagent_type="review-pr-sonnet", prompt="PR #<PR番号> をレビューしてください")
```

- Sonnet で実行、クリーンコンテキスト
- 結果は **PR コメント + ISSUE コメント** の両方に投稿される
- ProcessFlow 実行セマンティクスは Step 5.5 で済んでいるので **重複検証しない**

## Step 7: 残件対応 (Rule 10/11/12)

`gh issue view $ARGUMENTS --comments` でレビュー結果を読む。

### Must-fix / スコープ内 Should-fix が 0 件

→ Step 8 (マージ) へ

### スコープ外指摘あり

→ 別 ISSUE を起票し、元 PR 本文に `スコープ外指摘は #<新ISSUE> に分離` を明示 → Step 8 へ

### スコープ内 Must-fix / Should-fix あり

1. Codex (or Sonnet) に修正指示 (Step 4 と同様に `--fresh`)
2. Step 6 に戻る (再レビュー)

## Step 8: squash マージ (Rule 10)

```bash
gh pr merge <PR番号> --squash --auto
```

PR タイトルに ISSUE 番号が含まれていることを確認してからマージ。

## Step 9: 完了報告

マージ完了後にユーザーへ短く報告:

- マージした PR 番号・URL
- クローズした ISSUE 番号
- 次に着手できる候補があれば提示

---

## 制約 (必守)

- **Opus は実装コードを書かない** — Codex/Sonnet サブエージェントが担当
- **ユーザーへの確認は不要** — build/test/review/merge 全て AI が完遂
- **Codex 呼び出しは常に `--fresh` 固定** — resume 選択プロンプトでブロックしない
- **全レビュー結果は ISSUE に記録** — Opus は PR を直接見に行かず ISSUE を読む
- **ブロック ISSUE**: 人間介入が必要とわかった場合 → スキップして次へ、ユーザーへ通知のみ
