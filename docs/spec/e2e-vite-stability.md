# e2e-vite-stability.md

Vite dev server (port 5173) が e2e batch 実行中に間欠 crash する問題の調査記録 + 既知回避策 (#992)。

## 観測症状

`collab/* + edit-session/* + edit-mode + ...` のような multi browser context 系 spec を batch 実行した際に、**Vite (port 5173) のみが crash** することが #980-A 作業中に観測された。

- crash 後は以降の test 全てが `net::ERR_CONNECTION_REFUSED` 連鎖 fail
- backend (port 5179) は同時に死なない (= Vite と独立 process)
- ulimit -n: 4096 (FD 不足ではない)

## 推定真因

**Playwright の actionability check 失敗 → click retry loop が WS 接続を蓄積 → close handshake 不完了で `ws` lib が unhandled error を emit → Vite Node プロセス crash** という連鎖。

実証には至っていないが、以下の上流 issue と症状が一致する:

| 上流 | 内容 | 状態 |
|---|---|---|
| [vitejs/vite#11991](https://github.com/vitejs/vite/issues/11991) | `RangeError: Invalid WebSocket frame: invalid status code WS_ERR_INVALID_CLOSE_CODE` で Vite が unhandled error 経由で crash | [PR #12007](https://github.com/vitejs/vite/pull/12007) で v4 で fix (socket-level error listener 追加) |
| [vitejs/vite#14177](https://github.com/vitejs/vite/issues/14177) | カスタム WebSocketServer 同居時に同じ症状 | open |
| [vitejs/vite#15688](https://github.com/vitejs/vite/issues/15688) | カスタム host/port での `RSV1 must be clear` | open |

v8 (本プロジェクトが利用中) でも socket-level handler は維持されているはずだが、Playwright multi-context での ungraceful close は別 path を踏む可能性がある。

## #980-A で投入済の **回避策** (現在 crash 症状を抑止しているもの)

以下の改善が **症状消失** をもたらしている。これらを巻き戻すと再発しうるので、変更時は注意:

1. **`.esd-toggle > * { pointer-events: none }`** (`frontend/src/styles/editSessionDropdown.css`)
   — `.esd-root` 親 div の pointer hit-test を解消。click が中継ボタンに届くようにし、Playwright の actionability check failure → click retry を防ぐ
2. **`frontend/e2e/helpers/editSessionDropdown.ts` 経由の DOM `dispatchEvent` click** (#980-A 層 A)
   — `page.evaluate(() => button.click())` で actionability check を完全 bypass
3. **PostToolUse hook `.claude/hooks/check-esd-click.mjs`** + skill `test-strategy` の同パターン強制
   — AI が新 spec を書くとき helper を使わずに `locator.click()` を書くと exit 2 でブロック
4. **`EditSessionDropdown.handleViewerAttach` の useEditSession 経由化**
   — myRole 伝播が壊れて take-over UX が timeout に陥らないようにし、retry loop を生む元の click 失敗を解消

要するに **「retry loop で WS が大量蓄積」する状況を最初から作らない** という方向で対症療法しており、Vite v8 の WS error handling 自体は調査段階。

## 再現 spec (scaffold)

`frontend/e2e/vite-stress.spec.ts` に意図的に多重 context で WS を急速 open/close する stress 試験を scaffold 済 (#992)。

- 既定では実行されない (`HARMONY_E2E_VITE_STRESS=1` env で gate)
- 手動実行: `HARMONY_E2E_VITE_STRESS=1 npx playwright test vite-stress.spec.ts`
- 各 cycle 後に `GET /__vite_ping` で Vite 生存確認、最後に backend (5179) の `/health` を probe
- 再現できれば `crashedAtCycle` がログに残るので真因切り分けの足掛かりになる

#930 の test 分類タグ整備が完了したら `@endurance` に分類する。

## 再発時のチェックリスト

別の e2e で類似症状 (Vite が batch 中に crash) が出たら以下を確認:

- [ ] backend は生存しているか (生存していれば原因は Vite 側、両方落ちていれば別の真因)
- [ ] 直前の test が EditSessionDropdown / 多重 BrowserContext / fetch retry loop を含むか
- [ ] `frontend/e2e/helpers/editSessionDropdown.ts` 経由でない `[data-testid^="esd-"]` への直接 click が混入していないか (`.claude/hooks/check-esd-click.mjs` で本来検出されるはず)
- [ ] Vite を v8.0.x → 最新 patch に上げる (HMR socket 関連の fix が後続 patch に入っている可能性)
- [ ] `vite-stress.spec.ts` を `HARMONY_E2E_VITE_STRESS=1` で走らせて crash を観察できるか確認
- [ ] crash 観察時は Vite stdout / stderr を確認 (`logs/` 直下、もしくは `npm run dev` の terminal)

## 関連

- 親 ISSUE: #992
- #980-A 関連 commit: 9707002 / 8ae5305
- #980 (#945 残 e2e skip 解消シリーズ)
- 上流: [vitejs/vite#11991](https://github.com/vitejs/vite/issues/11991) / [PR #12007](https://github.com/vitejs/vite/pull/12007)
