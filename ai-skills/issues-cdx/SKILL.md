---
name: issues-cdx
description: ISSUE を Opus 直接実装 + Codex CLI (cdx エイリアス) 反復レビューで完遂する。設計判断を先に確定 → user 不在中も自律実行。1 ISSUE / 複数 ISSUE 統合どちらも対応
argument-hint: <ISSUE番号> [追加ISSUE番号...] [自然言語の補足]
disable-model-invocation: true
---

<!--
  本 skill は **Claude Code 専用** (Codex 側からは呼ばない、`.agents/skills/` symlink なし)。
  AskUserQuestion / Monitor / run_in_background / TaskCreate 等の Claude Code harness 専用 tool に依存するため。
  Codex 側で同等のワークフローが欲しい場合は別 skill (tool-agnostic な手順記述) を新設する。

  使い方:
    `/issues-cdx 1354 1355 1356` のように 1 件以上の ISSUE 番号を指定。
    必要に応じて自然言語の補足指示を続ける (例:「設計判断を先に確定してから私は寝る」等)。

  /issues との違い:
    /issues          : Opus orchestrator (実装は Codex/Sonnet 委譲)、レビューは review-pr-sonnet subagent
    /issues-cdx      : Opus が直接実装、レビューは cdx (Codex CLI) を Bash で直接呼ぶ、設計確定→自律実行型

  前提:
    - gh CLI がパスに通っていること
    - backend が起動していること (MCP ツールが必要な ISSUE の場合)
    - `cdx` エイリアスが定義されていること (~/dotfiles/.bash_aliases 等で
      `cdx () { command codex --dangerously-bypass-approvals-and-sandbox "$@"; }` を定義済)
    - `disable-model-invocation: true`: ユーザーが明示的に `/issues-cdx <N>` と打った時のみ起動

  運用原則:
    - Opus = 設計判断 + 実装 + レビュー対応のすべてを担当 (Sonnet/Codex 委譲なし)
    - レビュー = cdx exec (Codex CLI 直接呼出し、subagent ではなく Bash 経由)
    - 設計判断は **着手前に AskUserQuestion で一括確定** (user 不在中の自律実行を可能にする)
    - レビュー approve まで commit→review→修正→commit→review の反復
    - スコープ外と判明した課題は **follow-up ISSUE で必ず trace 確立** (鉄則 0)
-->

ISSUE #$ARGUMENTS を Opus 直接実装 + cdx 反復レビュー方式で解決します。

## Step 0: ISSUE 群を読む

引数が複数 ISSUE 番号の場合は 1 コマンドで連結して取得 (Bash 内で `&&` 連結、各 ISSUE 間は `---SEP---` で区切る):

```bash
gh issue view <N1> && echo "---SEP---" && gh issue view <N2> && echo "---SEP---" && gh issue view <N3>
```

本文・ラベル・コメント・state を確認。自然言語の補足指示があれば user の追加要件として解釈する。

## Step 1: 統合 PR / 関連性判定

### 1-A: 各 ISSUE 本文に `## 🔗 統合 PR 情報` セクションがある

セクション記載の統合ブランチに従う (`/issues` Step 1 と同じ)。

### 1-B: 複数 ISSUE が指定されているが統合宣言なし

- 同一シリーズ派生 (タイトルや本文に共通の親 ISSUE / PR 参照)、または同根ファイル群を触る場合は **統合 PR 化を提案候補に**
- 完全に独立した別機能なら個別 PR

### 1-C: 1 ISSUE 単独

- 関連 open ISSUE 検索 (`gh issue list --state open --search "<keyword>"`)
- 関連発見 → 統合提案候補に

## Step 2: 規模実測 (重要、設計判断の根拠)

ISSUE 完了条件に「N 件を全消し」「N 件を全 pass」等の数量がある場合、**着手前に実測値を取得** して user に提示:

| ISSUE タイプ | 実測コマンド例 |
|---|---|
| typecheck errors の全消し系 | `npx tsc --noEmit \| grep -c "error TS"` (拡張前後で比較) |
| test fail の全 pass 系 | `npx vitest run --reporter=basic 2>&1 \| tail -3` |
| sample / fixture migration 系 | `find <dir> -name "*.json" \| wc -l` |
| schema 変更系 | `gh pr diff <PR> -- schemas/` で governance 確認 |

実測なしで AskUserQuestion すると「ISSUE 起票時の見積もり N 件」を信用してしまい、scope 判断が外れる。**必ず数字を持って質問する**。

## Step 3: 設計判断を **着手前に** 確定 (重要 — user 不在中の自律実行の前提)

### AskUserQuestion で一括確定

ISSUE 数だけ + 統合 PR 構成 + 規模判断分の質問を **1 回の AskUserQuestion でまとめて発行** (最大 4 質問)。

### 質問設計の禁止事項 (鉄則 0 違反防止)

- ❌ 「却下 / 現状維持 / defer」だけの選択肢提示は禁止
  - trace 確立 ISSUE は「対応する」前提。「却下」を並べると ISSUE 不要扱いのシグナルになり叱責される
  - memory `feedback_dont_offer_status_quo_for_trace_issues.md` 参照
- ✅ 「実施スコープ A / B / C」(全件 / 部分 / Phase 分割) を提示する
- ✅ defer する場合は理由を明示し、follow-up ISSUE での trace を含めた選択肢にする
- ❌ ギリシャ文字 (α / β / γ) を選択肢ヘッダーに使わない (日本語キーボードで入力不可、memory `feedback_no_greek_letters_in_options.md`)

### 質問パターン (今回の実例 = 3 ISSUE 統合)

1. ISSUE-A の実施方針 (承認 / 部分実施 / defer + 起票)
2. ISSUE-B の実施スコープ (全件 fix / Phase 分割 / defer)
3. ISSUE-C のアプローチ選択 (a / b / c 等 ISSUE 本文記載の候補から)
4. PR 構成 (統合 PR 1 本 / 個別 PR 複数 / 部分統合)

### user が寝た場合の前提確認

user 指示に「設計判断確定後に寝る」「自律完遂」「途中で止まらない」等があれば、AskUserQuestion を発行した後の処理を **完全自律モード** に切り替える:

- 以降の判断は user 確認なしで Opus が単独で行う
- レビュー指摘の解消・スコープ判断・follow-up ISSUE 起票も自律
- 着手不可な事故 (権限超過 / repo 状態異常) のみ ScheduleWakeup ではなく **その時点で停止して報告残し**

## Step 4: 統合ブランチ作成

```bash
git checkout -b feat/issue-<topic-slug>-series origin/main
# 例: feat/issue-1332-followup-series (派生シリーズの場合)
# 例: feat/issue-1354-<keyword>      (単独の場合)
```

worktree は使わない (本セッションで連続 commit するため、本 repo の branch 切替で十分。memory `feedback_no_worktree_sequential_work.md`)。

## Step 5: ISSUE 単位で commit

### 順序の原則

**小さい → 中規模 → 大きい** で進める。失敗時の rollback コストを最小化:

1. 文字列修正系 / description 同期 (commit 1)
2. 中規模ロジック追加 (commit 2)
3. 大規模 refactor / mass fix (commit 3+)

### Opus 直接実装の責務

- 全コードを Opus が **Edit / Write ツールで直接編集**
- Codex / Sonnet 委譲しない (本 skill の前提)
- 各 commit メッセージに ISSUE 番号 + 詳細 + 検証結果を記載
- commit message に `Closes #N` を含めない (PR description で一括処理)、`Refs #N` を使う

### 型変更 / fixture 大量修正の落とし穴 (今回学んだもの)

`({...} as unknown) as <Type>` パターンで type errors を一掃する誘惑があるが、**type fidelity を弱体化させる ため Codex Must-fix を必ず受ける**。代わりに:

- ✅ `const x: <Type> = { ... brand-only cast ... }` で type 注釈を残す
- ✅ `satisfies <Type>` も使える (excess property 検証は維持される)
- ✅ legacy field 参照は `(x as unknown as Record<string, unknown>).<field>` で意図明示
- ❌ outer object 全体の `as unknown as <Type>` cast はやらない (Codex に必ず指摘される)

詳細: 本 skill 末尾「失敗パターン集」#1。

## Step 6: PR 作成 (全 ISSUE 完了時に 1 本)

```bash
gh pr create --title "..." --body "$(cat <<'EOF'
## 概要
<目的>

## 修正内容
### #N1: ...
### #N2: ...
### #N3: ...

## 検証
- npm run build → 0 errors
- npx vitest run → X passed
- ...

## 関連
- 親メタ: #M
- 起源 PR: #P

Closes #N1
Closes #N2
Closes #N3
EOF
)"
```

**Closes は改行区切りで各 ISSUE 個別に書く** (`Closes #A, #B, #C` は先頭しか auto-close されない、AGENTS.md より)。

## Step 7: cdx review ループ (本 skill の核心)

### 7-1: cdx review の起動

**stdin 必須クローズ** (`</dev/null`) + **`timeout 1500` 必須** — これを忘れると codex が review 完了後も alive のまま hang し続け、Monitor の pgrep 検知が永久に効かなくなる事故が発生する (2026-05-27 PR #1377 Round 1 で実例):

```bash
source ~/dotfiles/.bash_aliases  # cdx 関数を読み込む

# timeout を必ず被せる (25 min hard limit、background hang 防止)
timeout 1500 cdx exec "PR #<PR番号> (branch <branch>) Round <N> 独立レビュー。

特に観点:
- schema governance #511 (グローバル schema 変更は AI 権限外、description のみは例外)
- 鉄則 0 (trace 確立、PR description / コメントだけで完了扱いは禁止)
- type fidelity (Codex は ({...} as unknown) as <Type> 等の outer cast を必ず指摘する)
- ISSUE 完了条件と本 PR 対応範囲の整合

cwd /workspaces/harmony/frontend (or backend) で npm run build / npx tsc --noEmit / npx vitest run 検証可能。

出力 format: Must-fix / Should-fix / Nit 分類、file:line 明記、最後に approve/reject 判断。" </dev/null > <log-file> 2>&1 &
```

実行は **必ず background** — codex は 5-30 分かかる。

### 7-2: 完了監視 (Monitor で 3 重検知 — 2026-05-27 強化)

**過去の事故 (PR #1377)**: cdx が review 全文を 2 回出力し、token 行が末尾でなくなる + 出力後も process が alive で hang → `tail -1 | grep "tokens used"` と `pgrep` の両方が無力化。対策として **3 重検知** を必ず用意する:

```bash
# Monitor: 30 秒ポーリングで 3 つの完了 signal を確認
f=<log-file>
while sleep 30; do
  if [ ! -f "$f" ]; then continue; fi
  # 1) tail -50 で token/判定 marker 確認 (duplicate output 対策、tail -1 では弱い)
  recent=$(tail -50 "$f" 2>/dev/null)
  if echo "$recent" | grep -qE "tokens used|tokens consumed"; then
    echo "cdx-completed-marker"; tail -15 "$f"; break
  fi
  # 2) Idle detection: log mtime が 90 秒以上停止 → 完了とみなす (hang 検知の主力)
  cur_mtime=$(stat -c '%Y' "$f" 2>/dev/null || echo 0)
  now=$(date +%s)
  if [ "$cur_mtime" -gt 0 ] && [ $((now - cur_mtime)) -gt 90 ]; then
    echo "cdx-idle-90s"; tail -15 "$f"; break
  fi
  # 3) Process exited (timeout 1500 で kill されるはず)
  if ! pgrep -f "exec PR #<N>.*Round <R>" > /dev/null 2>&1; then
    echo "cdx-process-exited"; tail -15 "$f" 2>/dev/null; break
  fi
done
```

Monitor の timeout は 2400000 ms (40 min) で OK (cdx 自体に `timeout 1500` 被せてあるため上限は 25 min)。

**NG パターン (使わない)**:
- ❌ `tail -1 | grep "tokens used"` — cdx の duplicate output で末尾が `Reject` 等になり token 行を見逃す
- ❌ pgrep 単独 — review 出力完了後も process が alive のまま hang する事故あり
- ❌ Idle detection なし — `timeout` を付け忘れた場合の fail-safe が無くなる

### 7-3: 結果分類

cdx は **Must-fix / Should-fix / Nit / approve・reject** の形式で返す。

| 種別 | 対応 |
|---|---|
| Must-fix | 全件解消必須、commit して次 round へ |
| Should-fix (スコープ内) | 解消推奨。scope 外なら follow-up ISSUE 化 |
| Should-fix (scope 外) | follow-up ISSUE 起票 (鉄則 0 trace)、PR description に link |
| Nit | 余力あれば対応、approve 阻害しない |
| approve | Step 8 (merge) へ |

### 7-4: 修正 commit のメッセージ規約

`fix(test-infra): Codex Round <N> Must-fix 解消 — <要点>` 形式で、解消した指摘を箇条書きで記載。次 round 再投時の prompt に含めて codex に差分を理解させる。

### 7-5: 反復

```
commit → cdx review → Must-fix 解消 commit → cdx review (Round N+1) → ...
```

**approve が出るまで永遠に反復する** (本 skill の前提)。

## Step 8: スコープ外指摘 → follow-up ISSUE 起票 (鉄則 0)

cdx が指摘した残課題のうち本 PR で吸収不可なものは **必ず follow-up ISSUE 化**:

```bash
gh issue create --title "improve(<area>): <要約> (#<元 PR>派生)" --body "$(cat <<'EOF'
## 背景
PR #<元 PR> で <作業内容> を実装したが、Codex Round <N> で以下の残対応が判明...

## 残対応 / 想定アプローチ
- Phase 1: ...
- Phase 2: ...

## スコープ外
- 本 ISSUE の trace 確立のみが目的、実装は別途

## 関連
- 親 PR: #<元 PR>
- AGENTS.md 鉄則 0
EOF
)" --label "priority: low"
```

起票後、以下に番号を埋め込む:

- 元 ISSUE の本文 (該当する場合) → `gh issue edit <N> --body-file` で scope 訂正
- PR description → follow-up link を「関連」セクションに追記
- code の relevant comment (例: deprecated alias 付近) → `(#<新 ISSUE> で削除予定)` を JSDoc に追加

## Step 9: squash merge

cdx が **approve** した後:

```bash
gh pr merge <PR番号> --squash --auto
```

merge 後に ISSUE state を確認:

```bash
gh issue view <N1> --json state --jq .state  # CLOSED 確認
```

## Step 10: 完了報告

`/issues` Step 9 と同じ。マージした PR 番号 / closed ISSUE 番号 / follow-up ISSUE 番号 / `/clear` 推奨判断 + 次プロンプト提示。

---

## 失敗パターン集 (今回学んだもの、回避必須)

### 1. type fidelity 弱体化 (Codex Must-fix の頻出パターン)

**禁止**:
```ts
const step = ({
  id: "s",
  kind: "compute",
  description: "",
  ...
} as unknown) as ComputeStep;  // ← outer cast で excess property 検証無効化
```

**正解**:
```ts
const step: ComputeStep = {
  id: "s" as LocalId,            // brand 局所 cast
  kind: "compute",
  description: "" as Description,
  expression: "@x" as TemplateString,
};
```

または `satisfies` を使う:
```ts
const step = {
  id: "s" as LocalId,
  kind: "compute" as const,
  ...
} satisfies ComputeStep;
```

### 2. cdx exec の stdin 開きっぱなし → 永久 hang

```bash
# 禁止: 30 分 hang する
cdx exec "..."

# 正解: stdin を /dev/null で閉じる
cdx exec "..." </dev/null
```

### 3. AskUserQuestion で「却下」選択肢を出す → 鉄則 0 違反シグナル

trace 確立 ISSUE (鉄則 0 のために起票された ISSUE) は **対応前提**。「却下 / 現状維持」を並べると user から「ISSUE 不要扱い?」と叱責される。

`feedback_dont_offer_status_quo_for_trace_issues.md` 参照。

### 4. ISSUE 完了条件と実測の乖離を放置 → Codex reject

ISSUE 本文の完了条件 (例: 「workers=2 で全 test pass」) が本 PR の対応範囲を超える場合、**ISSUE 本文を編集してスコープを訂正** + **follow-up ISSUE で残対応を trace**。

放置すると Codex review が必ず reject する。

### 5. pre-existing tech debt を本 PR で無理に吸収 → scope creep

別 ISSUE 由来の broken state (例: `Project` → `Harmony` 未追従の e2e 側) を本 PR で全部 rename しようとすると 20+ files の修正が発生。

**正解**: 暫定的に backward compat alias 等で build gate を通過させ、完全 rename は follow-up ISSUE 化。

### 6. cdx Round 1 で完璧を期待しない

cdx review は 1 round で全件出ない。Round 1 で気付かなかった問題が Round 2/3 で出る (前 round の修正が新たな盲点を作る)。

**前提**: 3-5 round の反復を許容、各 round の修正 commit を分けて trace を残す。

### 7. backward compat alias の trace 義務

`/** @deprecated */` だけでは AGENTS.md 鉄則 0 に違反する (PR description / コメントだけは禁止)。alias 追加と同じ commit で **follow-up ISSUE を起票** し、JSDoc / コメントに ISSUE 番号を埋め込む。

### 8. cdx の background 起動で Monitor 監視

cdx は 5-30 分かかるため必ず background。Monitor で polling すると process 終了を検知できる:

```
Monitor:
  while sleep 60; do
    if ! pgrep -f "exec PR #<N>.*Round <R>" > /dev/null 2>&1; then break; fi
  done
```

timeout は 40-45 min を目安に。実時間 25-30 min 程度が多いが余裕を持つ。

---

## /issues との使い分け

| 状況 | 推奨 skill |
|---|---|
| 単独 ISSUE、Sonnet/Codex 委譲で OK | `/issues` |
| ISSUE 規模が中程度 (commit 数 < 5)、設計判断複雑、user 不在中に自律完遂したい | `/issues-cdx` |
| 複数 ISSUE 派生、Codex の厳格レビューで type fidelity を担保したい | `/issues-cdx` |
| user 介入を残したい (途中で user に再確認) | `/issues` |
| cdx エイリアスが未定義 / Codex CLI が使えない環境 | `/issues` |

---

## 制約 (必守)

- **Opus が実装の全責任を持つ** — Sonnet / Codex subagent への委譲なし
- **レビューは cdx (Bash) 直接呼出し** — review-pr-sonnet subagent は使わない
- **設計判断は AskUserQuestion で着手前に一括確定** — user 不在中の自律実行の前提
- **cdx exec は `</dev/null` で stdin closed 必須**
- **approve まで反復** — Round 1 で完璧を期待しない
- **scope 外指摘は follow-up ISSUE で必ず trace** (鉄則 0)
- **type fidelity を弱体化させる outer cast は使わない** (`({...} as unknown) as X` 禁止)
