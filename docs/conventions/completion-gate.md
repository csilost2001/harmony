# 完了判定 / merge gate 規約

#1299 Round 12-14 で発生した「full regression に 8 fail 残ったまま merge-ready 判定」
「単一 spec の strict-mode 違反を isolation pass = flake と誤判定」事故を受け、
private memory ベースの判定ルールを repo tracked な規約に昇格したもの (#1346 case A/B)。

全 AI orchestrator (Claude Code / Codex / Antigravity) は本規約に従う。

## 1. 原則 — 「full suite に failure が残ったまま完了報告しない」

PR を merge 可と判定する前に、以下のいずれかを満たさなければならない:

- (a) `npm run test:e2e:regression` が **全 pass**
- (b) 残 fail が `scripts/verify/regression-trace-check.mjs` で **全件 trace 済または flake 確認済** と判定される (exit 0)

(a)(b) のどちらでもないまま「merge-ready」と申告するのは禁止。第 3 の選択肢
(「次セッションで対応」「memory にメモ」「PR description に将来課題として記録」等)
は鉄則 0 違反であり、本規約でも明示的に禁止する。

## 2. trace 済の定義

failed spec を「trace 済」と判定するには、以下のいずれか:

- **OPEN ISSUE が title または body に spec path (or basename) を含んでいる**
  - 例: ISSUE #1342 が `e2e/presence-list.spec.ts:110` の trace を引き受けている
  - 機械検証は `gh issue list --state open --search "<spec-basename>"` + client side で
    title/body に spec path を実際含むものへ絞り込む (search index の noisy match を除去)
- **本 PR で実装される fix で同時に該当 fail が解消される** (= 本 PR description に
  `Closes #N` で trace されている)

CLOSED ISSUE は trace と認めない。**鉄則 0 違反防止** で、closed ISSUE への
申し送りコメントは誰も読まないため (memory `feedback_closed_issue_note_not_trace.md`)。

## 3. flake 判定の厳格化 — isolation 3x pass 証跡必須 (#1346 case C)

「isolation pass = flake」と判定するには、以下を満たすこと:

1. spec を **isolation で 3 回連続 pass** させた証跡 JSON が
   `frontend/test-results/isolation-<sanitized>.json` に存在
2. 証跡の `runs` 配列の **末尾 3 件** が `{ "status": "passed", ... }` である
3. その間に locator が **strict-mode violation** を起こす可能性が無いことを human
   または別 AI が確認済 (本規約 §4 参照)

`runs` は累積記録 (前段に failed run があっても末尾 3 連続 pass で確定 OK)。証跡は
`--auto-isolation-rerun` flag で `regression-trace-check.mjs` に自動生成させても良い。

### Strict-mode 違反は flake 扱い禁止

以下に該当する spec は、**isolation で何度 pass しても flake と判定しない**:

- `getByText` / `getByRole` / `getByLabel` 等で **同名要素が複数描画され得る画面** を
  scope 指定なしで叩いている
- `.first()` / `.last()` / `.locator(...).filter(...)` / scope 限定の `getByTestId`
  のいずれも付与されていない

このような spec は **isolation pass / full-run fail のばらつき** が「先行 test の状態
残留 + 並列実行 race」ではなく **locator 設計バグ** に由来する可能性が高く、
isolation pass を flake 根拠にすると次の round で必ず再現する (Round 12 の
`presence-list:110` 事故そのもの)。`.first()` 等の付与または scope 修正を行い、
別 ISSUE で trace する。

参考 memory: `feedback_e2e_flake_isolation_vs_full_run.md` の補強事項。

## 4. orchestrator の機械チェック手順

PR を merge 可と判定する前に、orchestrator が必ず実行:

```bash
# 推奨: --auto-run (npm banner を介さず playwright を直接 spawn するため shell redirect 不要)
node scripts/verify/regression-trace-check.mjs --auto-run
#   flake 主張ありの場合:
node scripts/verify/regression-trace-check.mjs --auto-run \
  --flake e2e/folder-picker.spec.ts \
  --auto-isolation-rerun

# 別法: 既に regression を走らせて results.json を持っている場合
#   ※ `npm run` は banner を stdout に出す。shell redirect で file 化する時は `--silent` 必須
npm run --silent test:e2e:regression:json > .tmp/regression-results.json || true
node scripts/verify/regression-trace-check.mjs .tmp/regression-results.json
```

- exit 0 → 全 fail trace 済 / flake 確認済 → merge 可
- exit 1 → trace なし fail 残存 → **merge 不可**。trace ISSUE を起票するか、本 PR で fail を解消する
- exit 2 → 入力 / 設定エラー → 原因究明して再走、未解消で merge 不可

## 5. private memory との関係

本規約は以下の 3 件の private memory を repo tracked 化したもの:

- `feedback_orchestrator_completion_gate.md` (HEAD 実走 / 自己申告で完了判定しない)
- `feedback_completion_blocker_weak_assertions.md` (skip 追加 / 弱 assertion を解消と数えない)
- `feedback_derived_issue_state_cross_check.md` (派生 ISSUE state の機械照合)

private memory は per-user / per-machine のため、Codex / Antigravity / 他セッションから
強制不能。本規約 + `scripts/verify/regression-trace-check.mjs` が共通の機械化された
gate として機能する。

## 6. 関連

- 親 ISSUE: #1346 (本規約の起源)
- 元 review: https://github.com/csilost2001/harmony/issues/1299#issuecomment-4540425126
- script: `scripts/verify/regression-trace-check.mjs`
- script test: `scripts/verify/test.mjs`
- AGENTS.md §「regression suite ↔ trace ISSUE 機械照合 gate (#1346)」
