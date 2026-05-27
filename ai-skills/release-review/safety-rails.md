# Safety rails — destructive 検出 + self-stop

24h 規模で自律稼働する skill のため、暴走時の被害を最小化する。AI が「これ位なら」と勝手に判断して main 汚染 / 履歴破壊 / 設計者の意図しない schema 変更 を起こさないよう、orchestrator が **必ず check + 即停止** する。

## 自動停止トリガー (即時 self-stop)

orchestrator は各 step の前後で以下を check し、いずれか引っ掛かれば **その wake で finalize、次 wake を予約しない**。

### 1. commit サイズ guard

```bash
# auto-fix 試行直後
DIFF_LINES=$(git diff HEAD~1 HEAD --stat | tail -1 | grep -oE "[0-9]+ insert" | head -1 | grep -oE "[0-9]+")
if [[ ${DIFF_LINES:-0} -gt 200 ]]; then
  # → 即 self-stop
fi
```

200 行超の diff は auto-fix が classification を誤判定した可能性が高い (本来 issue 級)。

### 2. schemas/v3/*.json 変更検出

```bash
# auto-fix commit 直後
git diff HEAD~1 HEAD --name-only | grep -E "^schemas/v3/.*\.json$" && \
  # → 即 self-stop + 当該 commit を revert
```

schemas/v3/*.json は #511 governance により AI 単独修正禁止。orchestrator が auto-fix で touch するのは絶対 NG。

### 3. destructive git command 試行

orchestrator script (scripts/orchestrator.mjs) は以下の command を絶対に発行しない:

- `git push --force` / `--force-with-lease`
- `git reset --hard`
- `git checkout -- <path>` (uncommitted を捨てる)
- `git clean -f`
- `git branch -D` / `git tag -d`
- `rm -rf` (Bash 経由含む)

apply-fix worker (Agent dispatch 側) でも禁止。Agent briefing で明示。

### 4. push 先 branch 確認

```bash
CURRENT=$(git rev-parse --abbrev-ref HEAD)
if [[ "${CURRENT}" == "main" ]] || [[ "${CURRENT}" == "master" ]]; then
  # → 即 self-stop
fi
```

`release-review` 隔離 branch 以外への commit は禁止。worktree 経由で main HEAD が動いていた等の事故防止。

### 5. ISSUE 起票数 cap (--max-issues 指定時のみ)

```bash
if [[ -n "${MAX_ISSUES}" ]] && [[ "${ISSUED_COUNT}" -ge "${MAX_ISSUES}" ]]; then
  # → 自然停止 (ユーザー指定の hard cap)
fi
```

### 6. wall-clock cap (--max-hours)

```bash
ELAPSED_SEC=$(($(date +%s) - ${STARTED_AT_SEC}))
if [[ $((ELAPSED_SEC / 3600)) -ge ${MAX_HOURS:-36} ]]; then
  # → 自然停止
fi
```

default 36h、ユーザー指定可。budget hard cap。

### 7. 並列 Agent 異常終了率

```bash
# 連続 3 wake で dispatch した Agent の 50% 以上が errored / timeout なら
if [[ ${RECENT_ERROR_RATE:-0} -gt 50 ]]; then
  # → self-stop (infra 異常の可能性)
fi
```

network / API rate limit / token exhaustion 等の外部要因疑い。

## 停止時の挙動

self-stop 発火時、orchestrator は以下を順に実行:

1. **state.json に stop_flag=true + stop_reason 記録**
2. **STOPPED.md を ${ART_DIR}/STOPPED.md に書く**:

   ```markdown
   # release-review STOPPED — feat/release-review-20260527

   Stopped at: 2026-05-27 22:15 UTC (elapsed: 8h 15m)
   Reason: schema_governance_violation (auto-fix commit ad12345 が schemas/v3/screen.v3.schema.json を変更)

   ## 取った緊急対応
   - commit ad12345 を `git revert ad12345 --no-edit` で revert
   - 当該 finding を issue 起票に降格 (issue #2042)

   ## 統計 (停止時点)
   - 経過時間: 8h 15m
   - 完了 round: 14 / 24 (8 軸 × 3 巡)
   - auto-fix 累計: 23 commits
   - ISSUE 起票累計: 9 件 (release-review-issue: 7, spec-pending: 2)

   ## 次のアクション (ユーザー判断)
   - [ ] STOPPED.md の停止理由を確認
   - [ ] revert commit ad12345 が正しいか確認
   - [ ] 残り 10 round を再開するか、ここで打ち切るか判断
   - [ ] 再開する場合: `/release-review --resume --branch feat/release-review-20260527 --bypass schema_governance_violation`
   ```

3. **PushNotification 送信** (ツール利用可能なら):

   ```javascript
   PushNotification({
     title: "release-review stopped",
     body: `Reason: ${stop_reason}. See ${ART_DIR}/STOPPED.md`,
     priority: "high",
   });
   ```

4. **PR 作成** (auto-fix commit が残っている場合):

   ```bash
   gh pr create --title "chore(release-review): partial findings bundle (stopped)" \
     --body-file ${ART_DIR}/STOPPED.md \
     --draft  # draft 状態でユーザーレビュー待ち
   ```

5. **ScheduleWakeup を発行しない** (自己再帰停止)。

## ユーザー側の再開手段

ユーザーが STOPPED.md を読んで再開判断したら:

```bash
# 通常再開 (停止原因が解消済の場合)
/release-review --resume --branch feat/release-review-20260527

# 特定の safety rail を一時 bypass (要注意、明示的 opt-out)
/release-review --resume --branch <name> --bypass <reason_key>

# fresh start (state.json を初期化、軸を再走)
/release-review --restart --branch <name>
```

`--bypass` は **本 wake 限定**。次 wake 以降の safety rail は通常通り有効に戻る。

## 設計の意図

- **fail-loud > fail-silent**: 異常時は AI 自己判断で「リカバリ」せず、ユーザーに判断を求める
- **revert 容易性 > 進行速度**: 1 fix = 1 commit、隔離 branch、PR 経由で main 取り込みを徹底
- **trace 完全性**: STOPPED.md / state.json / findings.jsonl / auto-fixes.log / issues.log を全て残す
- **再開可能性**: 停止しても state.json で再開可、再開時は前回 state を尊重 (重複起票防止)
