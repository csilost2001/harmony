# 品質・性能の検査と道具 (改善提案 第 2 弾, #1496)

`npm run check` に入っている検査と、必要なときに手で回す道具の一覧。数値の根拠 (なぜその値か) は各スクリプトの冒頭コメントにある。

## `npm run check` に入っている検査

| 検査 | スクリプト | 見るもの |
|---|---|---|
| ビルドサイズの予算 | `scripts/verify/bundle-budget.mjs` | 最初に読む JS (入口) 850 kB 以下 / 他の 1 チャンク 400 kB 以下。画面は `frontend/src/routing/lazyViews.ts` 経由で遅延読み込みする。画面を静的に import し直すと入口が膨らんで失敗する。`@harmony/shared` は `package.json` の `"sideEffects": false` で、使わない関数が入口に入らない (これを外すと、shared に足した書き出し・取り込み・図などが、すべて入口に入る: 実測 709 kB → 885 kB)。shared に、import しただけで実行される処理 (登録・設定の書き換え) を足すときは、この前提を崩さないこと |
| 資料の鮮度検査 | `scripts/verify/docs-freshness.mjs` (`npm run check:docs`) | 資料の相対リンク・`npm run` の名前・AGENTS.md の Routing の表と画面の経路 (両方向)・UI 操作リファレンスの対象画面 / ルート / スクリーンショット・CLAUDE.md のスキル表を、実物と突き合わせる。知らせ (`-- --info`): 資料のない画面・古いスクリーンショット (`npm run docs:shots` で撮り直す)・索引にない仕様書。画面を足したら、Routing の表と UI 操作リファレンスを足す |
| スキーマと型の食い違い | `scripts/verify/types-drift.mjs` | `schemas/v3` の `$defs` と、手書きの `frontend/src/types/v3` の interface の項目名の差。既存の差は `types-drift.baseline.json`。新しい差は失敗。スキーマは設計者の専権なので、直すのは型の側 |
| フォーカス輪郭の検査 | `scripts/verify/no-new-outline-none.mjs` | キーボードのフォーカスの輪郭を消す宣言 (`outline: none` / `0`) を、ファイルごとに baseline (`no-new-outline-none.baseline.json`) より増やさない。新しい部品は、共通のフォーカスリング (`styles/a11y.css`) に任せる。消すなら、同じ規則に代わりの見た目 (box-shadow・border-color) を書き、`-- --update` で baseline を更新 |
| E2E の無条件 skip | `scripts/verify/no-unconditional-e2e-skip.mjs` | 題名だけの常時 skip (`test.skip("題名", …)` / `test.describe.skip` / `test.fixme`) を失敗にする。条件つきの skip は可 |
| 型検査の抑止 | `scripts/verify/no-type-suppression.mjs` | テスト以外の `@ts-nocheck` / `@ts-ignore` / `@ts-expect-error` を失敗にする |
| 秘密の混入の検査 | `scripts/verify/no-secrets.mjs` | git が管理するファイルに、API キー (AWS・GitHub・Anthropic・OpenAI・Slack・Google)・秘密鍵・JWT の形の文字列がないか。試験・検査自身は除く。見つけても全文は出さない |
| コードの衛生の検査 | `scripts/verify/hygiene.mjs` | 予算で守る: 理由 (`-- 理由`) のない `eslint-disable` (45 件まで)・backend の `console.*` 直書き (48 件まで。ログは `serverLog` 経由)・1500 行を超える既存ファイル (いまの行数より増やさない)。`.only(` と、`TODO(#番号)` でない TODO / FIXME は 0 件。数を下げたら、予算も下げる (`--print` でいまの数) |
| frontend lint | `scripts/verify/check.mjs` | ESLint の警告は 18 件まで (`--max-warnings`)。増やさない |
| html-qa の試験 | `node --test ai-skills/html-qa/scripts/ scripts/dev/html-qa-markers.test.mjs` | html-qa スキルの build (形式の検査・版の違いの要約・議題一覧) と、回答を Harmony のマーカーにする変換の試験 (`npm run check` に含まれる) |
| 検査スクリプトの試験 | `scripts/verify/test.mjs` | `check-design.mjs` ほか、検査スクリプト自身の試験 (4 秒)。以前は `npm run check` に入っておらず、仕様の変更に追従していない試験が見つからなかった |

## 手で回す道具

| 用途 | コマンド |
|---|---|
| 差分の行のカバレッジ (PR 本文に載せる) | `npm run coverage:changed` (全体の割合も見るときは `npm run coverage`) |
| E2E の遅い試験・flake の一覧と履歴 | `(cd frontend && HARMONY_E2E_RETRIES=1 npx playwright test) && npm run e2e:report` |
| 依存の健全性 (脆弱性・ライセンス・ロックの整合・未使用・古さ・Node の版) | `npm run check:deps` (`scripts/dev/deps-report.mjs`。ネットワークを使うので `check` には含めない。high 以上の脆弱性は 0 件が予算。`-- audit license` のように絞れる) |
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
- `backend/src/prewarm.ts` — ワークスペースを開いた直後に、重い読み出しを裏で温める (`wsBridge.ts` の `schedulePrewarm`。ワークスペースごとにプロセスで 1 回。`HARMONY_NO_PREWARM=1` で無効にできる)。
- `schemaIssues.ts` / `workspaceHealth.ts` — ファイルごとに `fileMemo` で、変わったファイルだけ再検査する。全体は `dataSignature` (`memoizeBySignature`) で、何も変わらないあいだは丸ごと使い回す。結果が別のファイルにも依存するもの (旧形式の画面 = 旧デザイン・画面項目・`harmony.json` の登録簿) は、依存先も印に渡す。`fileMemo` は削除されたファイルの項目を上限 (20,000 件) まで残す (上限を超えると古いものから捨てる)
- ブラウザ側の `frontend/src/utils/sharedInflight.ts` — 同じ RPC が同時に飛んだら 1 回にまとめる (結果は `structuredClone` して渡す)。読み出し以外の RPC の成功後と、サーバーの変更通知 (broadcast) の受信時は、`mcpBridge` が全部を `invalidateAllInflight` する (改名・削除・MCP 経由の変更のあとに、変更前の進行中の読み出しへ相乗りさせない。結線は `mcp/mcpBridge.inflight.test.ts` が、読み出しかどうかの分類 (名前の接頭辞の規則 `isReadOnlyRpc`) は、書き込みを表す名前の RPC が読み出し扱いにならないことを台帳に対して検査する)。

## 測って「要らない」と判断したもの

| 案 | 測った結果 | 判断 |
|---|---|---|
| backend の worker thread 化 | 重い読み出し中のイベントループの最大停止が 75〜120 ms | 不要 |
| 一覧の仮想スクロール | 1,500 行で 2.3 秒 | 不要 (再測定は perf-scale) |
| ディスクキャッシュ | prewarm + 使い回しで足りる | 不要 |

規模がさらに大きくなったら、`bench-backend.mts` で測り直してから判断する。

## 配布後の古いタブ

画面のチャンクはハッシュつきで、配布側 (`backend/src/staticAssets.ts`) は `assets/` (Vite)・`_astro/` 直下を `Cache-Control: immutable` で返し (index.html は `no-cache`)、存在しない拡張子つきのパスは 404 にする。更新のあと、開いたままのタブで古いチャンクが取れなかったときは、`utils/preloadErrorReload.ts` (`vite:preloadError`) が 1 回だけ再読み込みする (10 秒以内に再読み込み済みなら、通常のエラー画面)。

## 循環 import の注意

`mcpBridge` ⇄ `codexClient` は循環している。新しい import は既存の import 行の**後ろ**に足す (`importCycle.test.ts` が検査する)。
