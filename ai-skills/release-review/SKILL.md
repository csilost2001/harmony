---
name: release-review
description: リリース前の徹底レビュー — 8 軸 × 複数巡で repo をしらみつぶしに自律監査し、findings を auto-fix / ISSUE 化 / spec-pending に分類して 24h 規模で進める。ユーザー睡眠中も自己再帰で稼働。
argument-hint: [--branch <name>] [--max-issues <N>] [--exclude-axes <csv>] [--max-hours <N>]
disable-model-invocation: true
---

<!--
  使い方:
    `/release-review`               # 全 default で起動
    `/release-review --max-hours 24` # wall-clock cap を 24h に
    `/release-review --exclude-axes 08-dogfood-smoke` # 重い軸を除外

  前提:
    - 起動 AI = Claude Code (Opus or Sonnet)、 backend dev server (port 5179) が常駐
    - gh CLI 認証済み、push 権限あり
    - リリース前タイミング (AGENTS.md 鉄則は緩和、本 skill 期間中は massive ISSUE 起票許可)

  起動形態:
    本 skill は **orchestrator + /loop self-pace** で 24h 規模で動く。
    起動セッションが /loop に移行し、ScheduleWakeup で自己再帰、各 wake で
    axis Agent を並列 dispatch + finding 分類 + auto-fix or ISSUE 化を実行。

  停止条件 (いずれか満たすと自然停止):
    - 全 8 軸が 3 巡連続で新規 finding 0 件 (枯渇判定、default)
    - `--max-hours` 経過 (default 36h、safety cap)
    - destructive action 検出 (safety-rails.md 参照)
    - 累計 ISSUE 起票数 = `--max-issues` (default なし、ユーザー指定時のみ)

  artifact 配置:
    .tmp/release-review/<branch>/
      state.json            # 軸ごとの round / status / last finding count
      findings.jsonl        # 全 findings (append-only)
      STATUS.md             # 人間用 dashboard (各 wake で再生成)
      auto-fixes.log        # commit history
      issues.log            # gh issue create history
      STOPPED.md            # 停止時のみ生成、停止理由 + 統計を記録

  関連 docs:
    - orchestrator-briefing.md  各 wake で実行する手順
    - classification-rules.md   auto-fix / issue / spec-pending の境界
    - safety-rails.md           destructive 検出 + self-stop
    - axes/01〜08.md            各軸の scope / 必須 grep / 出力 format
-->

# /release-review — リリース前徹底レビュー orchestrator

リリース前限定の自律レビュー skill。AGENTS.md の ISSUE 起票鉄則を **本 skill 起動期間に限り** 緩和し、findings は ユーザー判断ルール (`classification-rules.md`) で auto-fix / ISSUE 化 / spec-pending pending に振り分ける。

## 起動時の動作 (この skill を invoke した Claude)

ユーザーが `/release-review` と打った直後、本 doc の指示に従って **kickoff sequence** を実行する。以降は `/loop` に乗せて自走させる。

### Step 0: 引数 parse + 既存 review の検出

```bash
# 引数を環境変数に展開 (未指定は default)
BRANCH="${BRANCH:-feat/release-review-$(date +%Y%m%d)}"
MAX_HOURS="${MAX_HOURS:-36}"
MAX_ISSUES="${MAX_ISSUES:-}"   # 空 = 上限なし
EXCLUDE_AXES="${EXCLUDE_AXES:-}"

# 既存 review 進行中チェック
if [[ -f ".tmp/release-review/${BRANCH}/state.json" ]]; then
  # ユーザーに resume か restart か確認
  echo "既存の review が見つかりました: ${BRANCH}"
  # → AskUserQuestion で resume / restart / 新ブランチ
fi
```

### Step 1: 隔離ブランチ作成 (or worktree)

```bash
git fetch origin main
# main 直接 commit 防止。隔離ブランチ作成。
git checkout -b "${BRANCH}" origin/main 2>/dev/null || git checkout "${BRANCH}"
git push -u origin "${BRANCH}"
```

別 session が main で作業中の場合は worktree (`.tmp/worktrees/release-review-<date>/`) に切り出す。

### Step 2: artifact dir 初期化

```bash
ART_DIR=".tmp/release-review/${BRANCH}"
mkdir -p "${ART_DIR}"
node ai-skills/release-review/scripts/orchestrator.mjs init \
  --branch "${BRANCH}" \
  --max-hours "${MAX_HOURS}" \
  --max-issues "${MAX_ISSUES:-0}" \
  --exclude-axes "${EXCLUDE_AXES}"
```

`state.json` が初期化される (8 軸 × round=0 / status=pending / last_findings=null)。

### Step 3: 初回 axis dispatch (並列最大 3 本)

`orchestrator.mjs next` で次に dispatch すべき axis 一覧を取得し、3 本まで並列 Agent 起動:

```javascript
// 擬似コード — 実際は Agent tool を 1 メッセージで複数 invoke
const next = JSON.parse(execSync(`node ai-skills/release-review/scripts/orchestrator.mjs next --branch ${BRANCH} --slots 3`));
// next = [{axis: "01-schema-spec-drift", round: 1}, ...]
for (const {axis, round} of next) {
  Agent({
    description: `release-review axis ${axis} round ${round}`,
    subagent_type: "general-purpose",
    prompt: <axis briefing を ai-skills/release-review/axes/${axis}.md から読んで埋め込む>,
    run_in_background: true,
  });
}
```

各 Agent は終了時に `${ART_DIR}/findings.jsonl` に 1 finding = 1 行で append (JSON Lines)。

### Step 4: /loop で自己再帰

最初の axis dispatch を流したら、**`/loop` skill を起動**して自己再帰モードに入る:

```
Skill({ skill: "loop", args: "/release-review --resume --branch <branch>" })
```

`/loop` は ScheduleWakeup で 30 分後の self-wake を予約。次回 wake では:

1. `orchestrator.mjs aggregate --branch <branch>` で findings.jsonl を分類
2. classification に応じて auto-fix commit / ISSUE 起票 / spec-pending ISSUE 起票
3. `orchestrator.mjs next --slots 3` で次の axis を dispatch
4. `orchestrator.mjs check-stop` で停止条件を判定
5. 停止条件 false → 再度 ScheduleWakeup、true → STOPPED.md 生成して終了

### Step 5 (停止後): 最終 PR / 集約 ISSUE

停止条件発火後:

```bash
# auto-fix commit が積まれていれば PR
if git log origin/main..HEAD --oneline | head -1 | grep -q .; then
  gh pr create --title "chore(release-review): findings auto-fix bundle (${BRANCH})" \
    --body "$(cat ${ART_DIR}/STOPPED.md)"
fi

# 集約 ISSUE が作られていればユーザーに dashboard を提示
cat ${ART_DIR}/STOPPED.md
```

ユーザーが起きたら STATUS.md / STOPPED.md を見て次のアクションを決める。

## 8 軸の overview

| # | 軸 | scope | 重さ |
|---|---|---|---|
| 01 | schema-spec-drift | schemas/*.json ↔ docs/spec/*.md ↔ TS 型 ↔ examples/* 三重照合 | 中 |
| 02 | process-flow-runtime | /review-flow 10 観点を全 examples 横断 (変数 lifecycle / TX / runIf / 補償 / event 双方向) | 重 |
| 03 | type-contract | brand drift / cast hack / `as any` / `unknown` を全 grep + sabotage | 中 |
| 04 | backend-storage | projectStorage の race / FS error path / lock immutability / draft persistence | 中 |
| 05 | frontend-store | autosave / fallback / localStorage 廃止後の残骸 / dirty-check | 軽 |
| 06 | test-coverage | public function vs vitest spec の網羅率、e2e click-path 抜け | 中 |
| 07 | security | path traversal / prototype pollution / runtime executor ban (TemplateString 仕様) | 中 |
| 08 | dogfood-smoke | `npm run dev` + Playwright headless で全画面 navigate + console error 監視 | 重 |

各軸の詳細 briefing は `axes/<N>-<name>.md`。Agent dispatch 時は briefing をそのまま prompt に埋め込む。

## Classification (詳細は classification-rules.md)

各 finding は Agent が以下を **必ず** self-classify して findings.jsonl に書く:

- `auto-fix`: docs typo / 例追加 / 言い換え / 明らかな bug fix (≤30 行 diff) — 即 commit
- `issue`: 実装バグ / test gap / 軽微改善 (1-3h で fix 可、別途 review が欲しい) — 軸単位の集約 ISSUE に sub-section 追加
- `spec-pending`: `schemas/v3/*.json` 変更必要 / 振る舞いが変わる spec 変更 — 個別 ISSUE 起票 + `spec-pending` label + 着手禁止 marker

判定が境界線の場合は **保守側 = issue 起票** に倒す (auto-fix で漏れて main 汚染 > ISSUE 数増加)。

## Safety rails (詳細は safety-rails.md)

orchestrator は以下のいずれか検出で **即 self-stop**:

- 単一 commit diff > 200 lines
- `schemas/v3/*.json` の差分が auto-fix commit に含まれる
- `git push --force` / `--force-with-lease` の試行
- `rm -rf` / `git reset --hard` 等の destructive command 兆候

self-stop 時は `${ART_DIR}/STOPPED.md` に理由と statistics を記録、orchestrator は次の wake をスケジュールしない。ユーザーに通知 (PushNotification 利用可なら send)。

## 進捗確認 (ユーザー向け)

ユーザーは以下のいずれかで進捗を見られる:

```bash
cat .tmp/release-review/<branch>/STATUS.md         # 軸別 / 巡別 finding 数 + 直近 actions
gh pr view <auto-fix bundle PR number>             # auto-fix の積み上げ
gh issue list --label release-review --state open  # 起票 ISSUE 一覧
```

## このskill自身の trace

本 skill が `auto-fix` で commit する全ては label `release-review-auto-fix` 付き ISSUE 集約 issue へ trace を残す。終了時に集約 ISSUE をユーザーに提示。
