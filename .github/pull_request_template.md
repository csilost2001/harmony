<!--
  このテンプレートは全項目を埋めてください。
  別セッションの Claude が `/review-pr <N>` で独立レビューする前提で構成されています。
  不要な項目は「N/A」を明記し、削除しないでください (レビュアーが見落としと区別するため)。
-->

## 関連

- Closes #<ISSUE_NUMBER>
- 仕様: docs/spec/<file>.md §X.Y
  - 該当する節を列挙。複数ある場合は全て。
  - spec が存在しない / 不備がある場合は「spec 側の不足点」欄に記載。

## 概要

<!-- 1〜3 行。なぜこの変更が必要か。何の問題を解決するか。実装詳細ではなく目的を書く。 -->

## 主な変更

<!--
  file 単位ではなく機能単位で列挙。例:
  - データモデル: TableMeta に no: number 追加
  - ソート中 Read-only モード: D&D ハンドル・Alt+↑↓・Ctrl+V を無効化
  - SortBar 新設: 多段ソートキー可視化と一括解除ボタン
-->

## 仕様逐条突合 (自己申告)

<!--
  feedback_spec_verification に従い、spec の各条項に対して実装 file:line を記載。
  「全条項 ✓」だけではレビュアーが検証できないため、必ず各条項を個別に列挙。

  例:
  - §3.9 (a) 選択・フォーカス移動可 → useListKeyboard.ts:175-218 ✓
  - §3.9 (b) ダブルクリック → activate 可 → useListKeyboard.ts:142-148 ✓
  - §3.9 (f) Ctrl+V 不可 → useListKeyboard.ts:113 ✓
  - §3.10 (b) DataList が item.no を描画 → DataList.tsx:334 ✓
  ...
-->

## レビューで特に見てほしい箇所

<!--
  PR を作っただけでは読み取れない情報を渡す:
  - 自分では判断が揺れた設計判断 (案 A/B で悩んだ、など)
  - 既存コードと衝突しうる箇所
  - spec が曖昧で解釈が必要だった部分
  - 「妥当そうに見えるが盲点がありそう」と感じた箇所
  - コミット履歴の特定コミット (例: f8ba1cc で後から追加した修正)
-->

## テスト

- Vitest: <N 件> (新規 <M 件>) — <対象フック/ユーティリティ>
- Playwright: <N 件> (新規 <M 件>) — <対象画面/フロー>
- MCP E2E: <N 件> — <対象 API> (該当する場合)

## UI 影響 / AI smoke test

- [ ] UI 影響あり (AI が chrome-devtools MCP / Playwright で smoke test 実施済み)
- [ ] UI 影響なし (auto テスト pass のみ)

### UI 影響ありの場合、AI smoke test で確認した項目

<!-- AI が何をどう確認したかを具体的に。例: -->

- [ ] <画面名>: <期待挙動> — chrome-devtools MCP で確認
- [ ] 保存直後の JSON が Git 差分で揺れない
- [ ] 既存機能のリグレッションなし

## regression trace gate (#1346, e2e 走らせた PR は必須)

<!--
  `npm run test:e2e:regression` を走らせた PR は、merge 前に
  `scripts/verify/regression-trace-check.mjs` で全 fail が trace 済 / flake 確認済か
  機械検証する (詳細: docs/conventions/completion-gate.md / AGENTS.md §「regression suite ↔ trace ISSUE 機械照合 gate」)。
  E2E を走らせなかった PR (docs / schema / config 等) は「N/A (e2e 未実行)」と明記。
-->

- [ ] `npm run test:e2e:regression:json > .tmp/regression-results.json` を実行
- [ ] `node scripts/verify/regression-trace-check.mjs .tmp/regression-results.json` を実行し exit 0
- [ ] flake 主張する spec があれば `--flake <path>` で渡し、`frontend/test-results/isolation-<sanitized>.json` に 3x pass 証跡あり
- [ ] N/A (e2e 未実行 PR / docs / schema / config 専用) — 該当時のみ理由を 1 行明記

## spec 側の不足点 / 提案

<!--
  実装中に spec の曖昧さ・抜け・誤りを発見した場合はここに記載。
  レビュアーが「実装バグ」か「spec 不備」かを判定する材料。
  該当なしの場合は「N/A」。
-->

## レビュー担当への申し送り

<!--
  別セッションの Claude にレビューしてもらう時、特に見てほしい観点。
  今回の PR 固有のコンテキスト (決定経緯、前提、未確定事項)。
  共通の盲点を疑ってほしい具体ポイント。
-->
