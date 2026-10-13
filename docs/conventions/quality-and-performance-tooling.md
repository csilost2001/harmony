# 品質・性能の検査と道具 (改善提案 第 2 弾, #1496)

`npm run check` に入っている検査と、必要なときに手で回す道具の一覧。数値の根拠 (なぜその値か) は各スクリプトの冒頭コメントにある。

## `npm run check` に入っている検査

| 検査 | スクリプト | 見るもの |
|---|---|---|
| ビルドサイズの予算 | `scripts/verify/bundle-budget.mjs` | 最初に読む JS (入口) 850 kB 以下 / 他の 1 チャンク 400 kB 以下。画面は `frontend/src/routing/lazyViews.ts` 経由で遅延読み込みする。画面を静的に import し直すと入口が膨らんで失敗する |
| スキーマと型の食い違い | `scripts/verify/types-drift.mjs` | `schemas/v3` の `$defs` と、手書きの `frontend/src/types/v3` の interface の項目名の差。既存の差は `types-drift.baseline.json`。新しい差は失敗。スキーマは設計者の専権なので、直すのは型の側 |
| E2E の無条件 skip | `scripts/verify/no-unconditional-e2e-skip.mjs` | 題名だけの常時 skip (`test.skip("題名", …)` / `test.describe.skip` / `test.fixme`) を失敗にする。条件つきの skip は可 |
| 型検査の抑止 | `scripts/verify/no-type-suppression.mjs` | テスト以外の `@ts-nocheck` / `@ts-ignore` / `@ts-expect-error` を失敗にする |
| frontend lint | `scripts/verify/check.mjs` | ESLint の警告は 18 件まで (`--max-warnings`)。増やさない |

## 手で回す道具

| 用途 | コマンド |
|---|---|
| 差分の行のカバレッジ (PR 本文に載せる) | `npm run coverage:changed` (全体の割合も見るときは `npm run coverage`) |
| E2E の遅い試験・flake の一覧と履歴 | `(cd frontend && HARMONY_E2E_RETRIES=1 npx playwright test) && npm run e2e:report` |
| E2E の並列数 | `HARMONY_E2E_WORKERS=<n>` (既定 2) |
| 他のブラウザ (任意。`@smoke` のみ) | `cd frontend && npm run e2e:cross-browser` (Firefox / WebKit のシステムライブラリが要る) |
| 規模を変えた性能 (回帰には含めない) | `npx playwright test e2e/perf-scale.spec.ts` / `e2e/perf-large-project.spec.ts` |
| backend の重い読み出しの時間 | `node scripts/dev/make-large-workspace.mjs examples/retail .tmp/perf/retail-x100 100` → `npx tsx scripts/dev/bench-backend.mts .tmp/perf/retail-x100` |
| スキーマの版の移行 | `npm run migrate:schema -- <workspace-dir> [--apply]` (`scripts/migrate-schema.mts`。top-level await を使うので `.mts`) |

## RPC の名前の台帳

ブラウザと backend の RPC メソッド名は `shared/src/rpcMethods.ts` に集約している。`mcpBridge.request` の第 1 引数は `RpcMethod` 型で、台帳に無い名前は型エラーになる。`backend/src/rpcMethods.test.ts` が、台帳と backend の実装の突き合わせを検査する。新しい RPC は、台帳 → backend → frontend の順に足す。

## backend の使い回し (キャッシュ)

- `backend/src/fileMemo.ts` — ファイルの stat (サイズ・更新時刻) の印が変わらない間、読み出し結果を使い回す。
- `resolveDataRoot` — stat の印で結果を使い回す (以前は呼び出しごとに探索して O(n²))。
- `backend/src/prewarm.ts` — ワークスペースを開いた直後に、重い読み出しを裏で温める (`wsBridge.ts` の `schedulePrewarm`)。
- `schemaIssues.ts` / `workspaceHealth.ts` — 変わったファイルだけ再検査する (`dataSignature` の印)。
- ブラウザ側の `frontend/src/utils/sharedInflight.ts` — 同じ RPC が同時に飛んだら 1 回にまとめる (結果は `structuredClone` して渡す。保存などで `invalidate`)。

## 測って「要らない」と判断したもの

| 案 | 測った結果 | 判断 |
|---|---|---|
| backend の worker thread 化 | 重い読み出し中のイベントループの最大停止が 75〜120 ms | 不要 |
| 一覧の仮想スクロール | 1,500 行で 2.3 秒 | 不要 (再測定は perf-scale) |
| ディスクキャッシュ | prewarm + 使い回しで足りる | 不要 |

規模がさらに大きくなったら、`bench-backend.mts` で測り直してから判断する。

## 循環 import の注意

`mcpBridge` ⇄ `codexClient` は循環している。新しい import は既存の import 行の**後ろ**に足す (`importCycle.test.ts` が検査する)。
