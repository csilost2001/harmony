# Orchestrator briefing — 各 wake で実行する手順

本 skill が `/loop` で自己再帰した時に、orchestrator が wake する度に実行する責務をここに集約する。SKILL.md の Step 4 以降のループ本体。

## Wake シーケンス (毎回実行)

### 1. state load

```bash
ART_DIR=".tmp/release-review/${BRANCH}"
node ai-skills/release-review/scripts/orchestrator.mjs status --branch "${BRANCH}"
```

state.json から以下を取得:

- 各軸の `round` / `status` (pending / dispatched / completed / stopped)
- `consecutive_zero_rounds` (枯渇判定用)
- `start_time` / `elapsed_hours`
- `issued_count` / `auto_fix_count`
- `stop_flag` (true なら以降を skip して finalize)

### 2. 前回 dispatch 分の取り込み

前回 wake で dispatch した axis Agent が完了して `findings.jsonl` に書き込んでいる可能性。差分を分類:

```bash
node ai-skills/release-review/scripts/orchestrator.mjs aggregate --branch "${BRANCH}"
```

aggregate は state.json の `last_processed_index` (per-axis) を参照して既処理 finding を skip する。「前回 wake 以降」の概念は内部 index で自動管理されるため、明示フラグは不要。

aggregate は各 finding を以下に振り分け:

- `classification: auto-fix` → 別 worker (本 wake 内で直接 fix 実装) に渡す
- `classification: issue` → 軸単位の集約 ISSUE に sub-section として追記 (または新規作成)
- `classification: spec-pending` → 個別 ISSUE 起票 (label `spec-pending`、着手禁止 marker 付き)

### 3. auto-fix の実施

aggregate が返した auto-fix list を順次処理。**1 fix = 1 commit** 原則:

```bash
for fix in $(cat ${ART_DIR}/pending-autofix.jsonl); do
  # diff < 200 lines / schemas/v3/*.json 含まない / destructive command 含まない を再検査
  node ai-skills/release-review/scripts/orchestrator.mjs apply-fix --fix-id "${fix.id}"
  # 失敗時は skip して issue 起票に降格
done
```

apply-fix は内部で:

1. fix 内容 (diff or 指示) を確認
2. Edit/Write tool で適用
3. tsc + vitest で smoke 確認 (失敗時は rollback + issue 降格)
4. `git commit -m "fix(<axis>): <title> (release-review auto-fix)"`
5. auto-fixes.log に追記
6. `node scripts/orchestrator.mjs increment-count --branch ${BRANCH} --field auto_fix_count` で state に反映

### 4. ISSUE 起票

集約 ISSUE への sub-section 追記 or 個別 ISSUE 起票:

```bash
# 軸単位の集約 ISSUE が無ければ作成
gh issue create --title "release-review: <axis> findings (${BRANCH})" \
  --label "release-review,release-review-issue" \
  --body "$(...sub-sections appendable body...)"

# 既存があれば edit --body で sub-section 追記
gh issue edit <N> --body-file <updated>
```

spec-pending は個別起票:

```bash
gh issue create --title "spec-pending: <title> (release-review)" \
  --label "release-review,spec-pending,blocked" \
  --body "<schema 変更 or 振る舞い変更の必要性 + 影響範囲>"
```

ISSUE 起票後 (集約 ISSUE の新規作成 / spec-pending 個別起票どちらも) は必ず:

```bash
node ai-skills/release-review/scripts/orchestrator.mjs increment-count \
  --branch "${BRANCH}" --field issued_count
```

を実行して state.issued_count を反映。`--max-issues` cap (safety-rails) はこの値で評価される。集約 ISSUE への sub-section 追記は新規 ISSUE ではないため increment しない。

### 5. 停止条件チェック

```bash
node ai-skills/release-review/scripts/orchestrator.mjs check-stop --branch "${BRANCH}"
```

返り値が `true` なら finalize へ:

```bash
node ai-skills/release-review/scripts/orchestrator.mjs finalize --branch "${BRANCH}"
# STOPPED.md 生成、PR 作成 (auto-fix commit がある場合)、PushNotification 送信
exit 0  # /loop を抜ける
```

返り値が `false` なら次の dispatch + ScheduleWakeup へ。

### 6. 次 axis dispatch (並列 3 本)

```bash
NEXT=$(node ai-skills/release-review/scripts/orchestrator.mjs next \
  --branch "${BRANCH}" --slots 3)
```

NEXT は dispatch すべき軸 + round のリスト (最大 3 件)。各 axis に対し `Agent` tool で並列起動 (1 メッセージ複数 tool call):

```javascript
for (const {axis, round} of NEXT) {
  Agent({
    description: `axis ${axis} r${round}`,
    subagent_type: "general-purpose",
    prompt: readFile(`ai-skills/release-review/axes/${axis}.md`)
      + `\n\n## このラウンドの追加 context\n`
      + `- branch: ${BRANCH}\n`
      + `- round: ${round}\n`
      + `- previous rounds findings (本軸): ${prevFindingsCount} 件\n`
      + `- output: 必ず .tmp/release-review/${BRANCH}/findings.jsonl に append (JSON Lines、1 line = 1 finding)\n`
      + `- 完了条件: 軸の scope に対し新規発見が無くなったら "completed" status で終了\n`,
    run_in_background: true,
  });
}
```

`run_in_background: true` で並列、完了通知は ScheduleWakeup の次回 fire 時に findings.jsonl 差分で検知。

### 7. STATUS.md 更新 + 次 wake 予約

```bash
node ai-skills/release-review/scripts/orchestrator.mjs status-md --branch "${BRANCH}"
# .tmp/release-review/<branch>/STATUS.md 再生成 (人間用 dashboard)
```

ScheduleWakeup で 30 分後の self-wake を予約:

```javascript
ScheduleWakeup({
  delaySeconds: 1800,  // 30 分 (cache miss 1 回で長い wait、効率的)
  reason: "release-review orchestrator next wake — aggregate + dispatch",
  prompt: "/release-review --resume --branch " + BRANCH,
});
```

## 失敗時の挙動

各 step で例外発生時:

- step 2-4 (aggregate / fix / issue): STOPPED.md に記録、orchestrator は次 wake を予約 (recoverable とみなす)
- step 5-7 (停止判定 / dispatch / schedule): STOPPED.md に記録 + push notification、wake 予約しない (致命)

## artifact 出力 spec

### findings.jsonl (JSON Lines)

各行が 1 finding:

```json
{"axis":"01-schema-spec-drift","round":1,"severity":"must","classification":"issue","file":"frontend/src/types/v3/screen.ts:123","title":"...","body":"...","fix_diff":null,"discovered_at":"2026-05-27T15:00:00.000Z"}
```

必須 field: `axis` / `round` / `severity` / `classification` / `title` / `body` / `discovered_at`。
任意 field: `file` / `fix_diff` (auto-fix 時のみ) / `evidence_paths`.

### state.json

```json
{
  "branch": "feat/release-review-20260527",
  "started_at": "2026-05-27T14:00:00.000Z",
  "max_hours": 36,
  "max_issues": null,
  "stop_flag": false,
  "stop_reason": null,
  "axes": {
    "01-schema-spec-drift": {"round": 2, "status": "completed", "consecutive_zero": 1, "last_findings": 3},
    "...": {}
  },
  "consecutive_global_zero_rounds": 0,
  "issued_count": 12,
  "auto_fix_count": 27
}
```

### STATUS.md (人間用 dashboard、各 wake で再生成)

```markdown
# release-review status — feat/release-review-20260527

Started: 2026-05-27 14:00 UTC (elapsed: 8h 22m)
Stop flag: false (枯渇 0/3 巡 / max-hours 8.4/36h)

## 軸別進捗

| 軸 | round | status | last findings | total |
|---|---|---|---|---|
| 01 schema-spec-drift | 2 | completed | 3 | 7 |
| ... |

## 直近 actions

- 14:30 auto-fix commit ad12345 — fix(docs): typo in schema-v3-design.md
- 14:45 issue #2001 created — release-review: type-contract findings
- ...
```
