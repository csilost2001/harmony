# ISSUE 起票・PR 運用の詳細規約

AGENTS.md から移設した詳細版 (2026-10-08)。AGENTS.md には要点のみを残している。

## ISSUE 起票の鉄則 (最重要、絶対遵守、全 AI)

**1 人で 100〜200 / 日のペースで増える open ISSUE を回している。気軽な分離は チーム運用を破壊する。**

ただし **「ISSUE を増やしたくない」を理由に放置するのは絶対禁止**。発見した課題は必ず「本 PR で対応」または「新規 ISSUE で受ける」のいずれかで処理する。第 3 の選択肢 (PR description / コメント / memory に "将来課題" として記録だけして放置) は trace を達成しないため**禁止**。

### 鉄則 0 (最優先): 放置は絶対にダメ

発見した課題は必ず以下のどちらかに振る。第 3 の選択肢は存在しない:

- (a) **本 PR / 本 ISSUE 内で対応** (デフォルト、最優先)
- (b) **新規 ISSUE で受ける** (本 ISSUE 不可な場合に限り、限定的に許可)

「PR description に将来課題として記録」「memory にメモ」「TODO コメントで退避」「次にこのファイル触るとき対応」等は **すべて放置** であり、第 3 選択肢として禁止。クローズ済 PR の description は誰も読まない、memory は recall されないこともある、TODO は風化する — いずれも trace 不可能。

### 鉄則 1: 本 PR / 本 ISSUE 内で対応するのが原則

別 ISSUE を起票したくなったら、まず以下を順に検討する:

1. **本 PR で同 commit / 同 description に吸収できないか** (1-3 時間以内なら必ず吸収)
2. **後続の親 / 子 ISSUE のスコープに自然に入らないか**
3. **同根の取り残しなら必ず同 PR で吸収** (memory `feedback_issue_split_hidden_costs.md`)

吸収可能なら吸収する。吸収不可な場合のみ鉄則 2 に進む (放置は鉄則 0 違反)。

### 鉄則 2: 本 ISSUE で対応不可な場合のみ新規 ISSUE で受ける

以下の **明確な根拠** が示せる場合のみ新規 ISSUE 起票が許可される:

1. **完全に別機能側のバグ / 改善** — 現在対応中の機能 / 領域と無関係
2. **フレームワーク全体の再設計が必要** — 1 PR では収まらない設計判断を要する
3. **かなり大規模** — 数日〜週単位の独立工数を要する
4. **別チームへの依頼** — 本リポジトリ外を含む

これらに該当しない小さな課題は **本 PR で吸収**。本 PR がマージ済なら **follow-up small PR を即作成して main に merge**。放置は禁止。

### 鉄則 3: 同根の複数提案は必ず 1 ISSUE に統合

同じ schema / 同じ spec / 同じ領域 / 同根の発見イベント (同 PR / 同 dogfood / 同調査) から出てきた提案は 1 ISSUE 内に sub-section (## 提案 A / B / C) で列挙する。

### 鉄則 4: フォローアップ連鎖の絶対禁止 + 起票後 24h 着手義務 (2026-05-28 #1379 → #1385 連鎖事故で新設)

**N 次フォローアップ (フォローアップから更にフォローアップが派生) は user 承認なしに起票禁止**。連鎖は ISSUE 純増コストを指数的に増やし、AI が「鉄則 0 を満たすため」と称して気軽に起票するパターンの温床。

定義:
- **0 次**: 本 PR の作業中に発見した課題
- **1 次フォローアップ**: 0 次から派生したフォローアップ (= 通常の「鉄則 2 で許容される新規 ISSUE」)
- **2 次フォローアップ**: 1 次フォローアップ ISSUE / PR の review 指摘 / 残課題から派生 → **user 承認必須**
- **3 次以降**: **絶対禁止** (user 承認不可、即停止して相談)

起票後の責務 (1 次・2 次ともに):
- **起票後 24 時間以内に着手** (= 実装 commit / WIP PR 作成)。それを超えるなら起票しない (= 本 PR で吸収するか、user に判断を委ねる)
- 着手見込みがないのに「trace 確立のため」と起票するのは鉄則 0 違反 (放置の婉曲表現)

実例 (#1379 → #1385 連鎖、2026-05-28):
- #1378 (#1375 実装) Must-fix #2 → #1379 (1 次) → PR #1382 Round 1 review 指摘 → #1385 (2 次、user 承認なし) で叱責「フォローアップ増殖キリがない」
- 教訓: review 指摘の trace 不足は **本 PR scope を広げて吸収** が原則。「pattern 再設計が必要」「規模が大きい」は AI の過大評価。1 件サンプル fix で実測してから判断

### 鉄則 5: 「規模が大きく見える」を follow-up 化の根拠にしない (2026-05-28 新設)

AI の「規模感覚」は不正確で、warning N 件 / file N 個を見て即「数日工数」と判断するのは怠慢。**必ず 1 件サンプル fix の所要時間 × N 件 + α で実測**してから follow-up 化の判断をする。

実測手順:
1. N 件のうち最も複雑そうな 1 件を実際に修正してみる
2. 所要時間 (実装 + verify) を計測
3. × N 件 + バッファ 30% で総工数を見積もる
4. 1-3 時間以内なら鉄則 1 (本 PR 吸収) を遵守、それ以上なら user に判断を委ねる

「機械的修正 vs pattern 再設計」を区別せず一律「大規模」とラベルするのは禁止。

### 鉄則 6: Codex / Sonnet review が選択肢を提示しても、本 PR 吸収がデフォルト (2026-05-28 新設)

Codex / Sonnet の独立レビューが「本 PR で吸収 or follow-up ISSUE 起票」を選択肢として提示することがある。**この場合、本 PR 吸収を default 選択** とし、follow-up 化はユーザー承認時のみ。

理由: AI 同士の review で「両方の選択肢を提示」されると、起票側 AI は安易に follow-up を選びがち (思考停止)。default を明示することで安易な分離を防ぐ。

### 禁止された逃げ口の理由付け

以下の理由はすべて禁止:

- ❌ 「schema governance により AI 単独実装禁止だから別 ISSUE 化」 — schema 提案も同 PR description / 統合 ISSUE に書けば良い
- ❌ 「scope 厳守のため別 ISSUE」 — 同根なら scope 内
- ❌ 「念のため別 ISSUE で隔離」 — ISSUE 純増コストが大きい
- ❌ 「pre-existing 問題なので別 ISSUE」 — 同ファイル / 同画面なら同 PR 吸収
- ❌ 「将来対応のため記録だけして放置」 — 鉄則 0 違反 (trace されない)
- ❌ 「次にこのファイル触る時にやる」 — 放置の婉曲表現、鉄則 0 違反
- ❌ 「PR description にメモするだけで trace 達成」 — クローズ済 PR は誰も見ない、放置と同義
- ❌ **「規模が大きく見えるから follow-up」 — 実測していない見積もりは禁止 (鉄則 5)**
- ❌ **「Codex / Sonnet review が follow-up を選択肢として提示したから」 — 提示されても本 PR 吸収がデフォルト (鉄則 6)**
- ❌ **「pattern 再設計が必要」を根拠に大量 warning / error を follow-up 化 — 1 件サンプル fix で機械的修正可能性を実証してから判断 (鉄則 5)**

### 起票直前の self-check (義務)

`gh issue create` を打つ **直前** に 9 項目すべて ✓ を確認:

1. ☐ 鉄則 0: 「放置せず必ず処理する」前提で考えている (記録だけして処理しない選択肢は無い)
2. ☐ 鉄則 1: 本 PR / follow-up small PR で吸収不可な明確な根拠を提示できる
3. ☐ 鉄則 2: 妥当条件 (別機能 / 再設計 / 大規模 / 別チーム) のいずれかに **明確に** 該当する
4. ☐ 鉄則 3: 他に同根の起票候補があるなら 1 ISSUE に統合する用意がある
5. ☐ 鉄則 4: **N 次 (N≥2) フォローアップでないこと、または user 承認を得ている**
6. ☐ 鉄則 4: **起票後 24h 以内に着手する確定計画がある** (small follow-up PR を作成する目処が立っている)
7. ☐ 鉄則 5: **「大規模」と判断する根拠は 1 件サンプル fix の実測値 × N 件 + α**
8. ☐ 「禁止された逃げ口」を理由にしていない (鉄則 6 の Codex review 提示も含む)
9. ☐ 「ISSUE 化しない」と決めた場合、必ず本 PR / follow-up small PR で対応する確定的な計画がある (放置していない)

1 つでも疑問が残るなら立ち止まり、放置を選ばないこと。

### 失敗事例 (再発防止のため記録)

- 2026-05-04 PR #780: 同根の framework 提案 3 件を #781/#782/#783 と別々に起票 → 2 件純増。同 schema (`schemas/v3/process-flow.v3.schema.json`) を触る同根提案は 1 ISSUE に統合すべきだった
- 2026-05-28 #1378 (#1375 派生) → #1379 (1 次) → #1382 Round 1 review trace 不足 → #1385 (2 次フォローアップ、user 承認なし) 起票で叱責「フォローアップ増殖キリがない」。鉄則 4-6 はこの事故を受けて新設

### 関連 memory (起票判断時に必読)

- `feedback_issue_split_criteria.md` (canonical 判定基準)
- `feedback_issue_split_hidden_costs.md` (トークン累積 + main 滞留コスト)
- `feedback_consolidate_related_proposals_into_one_issue.md` (鉄則 3 の具体例)
- `feedback_pr_scope_absorb_pre_existing.md` (pre-existing は同 PR 吸収)
- `feedback_pr_granularity.md` (PR を過度に細かく分けない)


## PR 作成・レビューの規約

運用手引き (人間向け): [docs/pr-review-workflow.md](docs/pr-review-workflow.md)

- PR 作成時は [`.github/pull_request_template.md`](.github/pull_request_template.md) を**全項目埋める**。不要な項目は削除せず「N/A」と明記 (レビュアーが見落としと区別するため)
- 「仕様逐条突合 (自己申告)」節は各条項を `file:line` で**個別に列挙**。「全条項 ✓」の一括表記は不可。大規模実装の完了報告前に仕様を逐条突合すること
- 大規模実装 / spec 絡み / UI 影響のある PR は、**別セッション (新しい会話)** で独立レビューを実行し、結果を PR コメントに投稿してからマージ判断する (Claude Code 利用時は `/review-pr <N>` スキル、Codex は `/codex:review`)
- **1 ISSUE を複数 PR に分割したケース**は、全 PR マージ後に ISSUE 単位の実装網羅性を監査する (Claude Code: `/review-issue <N>`)。PR 単位レビューでは検出できない実装漏れを拾う
- レビュー結果が Must-fix を含む場合はマージしない。Should-fix は AI が判断し、対応 or スコープ外として別 ISSUE 化
- **PR 単位 / 機能単位のユーザー確認は不要**。AI が build / test / UI smoke (chrome-devtools MCP / Playwright) / 独立レビュー / Must-fix 解決 / マージまで完遂する。ユーザー確認は**大規模改修一連の作業の最終リリース時のみ**

### regression suite ↔ trace ISSUE 機械照合 gate (#1346 / 必須、全 AI)

E2E regression (`npm run test:e2e:regression`) を走らせて failure が残った場合、**PR を merge する前**に `scripts/verify/regression-trace-check.mjs` で全 fail が「trace 済 OPEN ISSUE 参照あり」または「isolation 3x pass 証跡ありの flake」であることを機械検証する。

背景: #1299 Round 12-14 で「full suite に 8 fail 残ったまま merge-ready 判定」「単一 spec の strict-mode 違反を isolation pass = flake と誤判定」の事故が連続再発したため、private memory ベースの完了判定ルールを repo tracked な script に昇格 (case A)。

**呼び方** (一例 — orchestrator が必須で 1 回通す):

```bash
# 推奨: --auto-run (npm banner を介さず playwright を直接 spawn するため shell redirect の落とし穴を回避)
node scripts/verify/regression-trace-check.mjs --auto-run \
  --flake e2e/foo.spec.ts   # flake 主張する spec があれば明示

# 別法: 既に regression を走らせて results.json を持っている場合は file 渡し
#   注意: npm scripts は stdout 先頭に banner ("> harmony-workspace@... \n> playwright test ...") を出すため
#   shell redirect で file 化するときは必ず `--silent` を付ける (付けないと JSON parse fail で exit 2)
npm run --silent test:e2e:regression:json > .tmp/regression-results.json || true
node scripts/verify/regression-trace-check.mjs .tmp/regression-results.json \
  --flake e2e/foo.spec.ts
# isolation 3x pass の証跡 (frontend/test-results/isolation-<sanitized>.json) を別途要求
```

**判定**:

- exit 0 → 全 fail が OPEN ISSUE で trace 済 or flake 確認済 → merge gate 通過
- exit 1 → trace なし fail が 1 件以上 → **merge 禁止**。不足分の OPEN ISSUE を起票 (鉄則 0) して再走、または fail を解消するまで merge しない
- exit 2 → 入力エラー / gh 未配置等 → 設定不備、AI セッションでは原因究明して再走

**flake 主張する場合の必須証跡**:

isolation 再走 3 回連続 pass の JSON 証跡が `frontend/test-results/isolation-<sanitized>.json` に存在すること。`runs` の **末尾 3 件** が `{ "status": "passed", ... }` であれば flake 確定。前段に fail が混じっていても末尾 3 連続 pass なら OK。証跡 file は `--auto-isolation-rerun` flag で script に自動生成させることもできる。

**注意 (memory `feedback_e2e_flake_isolation_vs_full_run.md` の補足)**: locator selector が `strict-mode violation` を起こしうる場合 (例: 同 name の要素が複数描画される画面で `getByText` を直 use)、isolation pass を flake 根拠にしてはならない。`.first()` / `.last()` / specific scope (`.locator(...).filter(...)`) を必ず付与する。strict-mode の場合は flake ではなく実バグなので OPEN ISSUE で trace する。

詳細: `scripts/verify/regression-trace-check.mjs` の top コメント + `docs/conventions/completion-gate.md`。

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

## コミット・ブランチ・PR の書き方 (旧 AGENTS.md Conventions 節)

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
  **NG**: `Closes #A, #B, #C` は**先頭しか自動 close されない** (PR #340 で実例あり)。コミットは ISSUE 単位で分ける。独立レビューは**統合 PR 単位で 1 回**。

  **重要 (シリーズ PR 親 ISSUE 誤 close 防止、2026-05-17 PR #1163 で実証)**: シリーズ PR の **Phase 途中段階で親 ISSUE を open 維持したい場合は必ず `Refs #N` を使う**。`Closes` キーワードは inline backtick (`` `Closes #N` ``) で囲っても GitHub parser が context-aware で auto-close trigger として処理する場合あり (parser ヒューリスティクス不安定)。詳細は memory `feedback_pr_closes_code_block_invalidates.md`。

  Never commit directly to `main`. Branch naming: `feat/issue-<N>-<slug>` (単独 PR) / `feat/<topic-slug>` (統合 PR) for features, `fix/issue-<N>` or `fix/<slug>` for bug fixes, `docs/<slug>` for documentation-only changes. Create the branch from `origin/main` before starting work.
- PRs are squash-merged into `main`. The PR title should include the issue number (e.g., `feat(ui): ... (#83)`) so the merge commit references it.
- `data/` は本体専用 (`data/extensions/` のみ git tracked) + `workspaces/` がユーザー作業領域 (両方 gitignored)
- Themes: standard (default Bootstrap), card, compact, dark — CSS injected into GrapesJS canvas iframe
- Custom blocks persist to active workspace の `custom-blocks.json` via customBlockStore

