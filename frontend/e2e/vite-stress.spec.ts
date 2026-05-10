/**
 * Vite dev server crash 再現 spec scaffold (#992)
 *
 * #980-A 作業中、`collab/* + edit-session/* + edit-mode + ...` を batch 実行した際に
 * **Vite dev server (port 5173) が間欠的にクラッシュ** する現象を観測した。クラッシュ後は
 * 以降の test 全てが `net::ERR_CONNECTION_REFUSED` 連鎖 fail となる。
 *
 * 推定真因 (未検証):
 *   - 多重 browser context での Playwright actionability check 失敗 → click retry loop が
 *     WebSocket 接続を蓄積
 *   - Vite HMR socket 側で client 切断時の error が unhandled になり crash する既知問題
 *     (vitejs/vite#11991, PR #12007 で v4 で fix 済 — 同根ケースが v8 でも残存している可能性)
 *
 * 本 spec は **意図的に多重 context で WS を急速 open/close** して Vite を落とそうとする
 * stress 試験。再現すれば真因切り分けの足掛かりになる。再現しなくても negative observation
 * として価値がある (#992 が optimistic に close できる根拠になる)。
 *
 * ## 既定で実行されない理由
 *
 *   - 1 run で数分かかる + 副作用として実 backend / Vite を巻き込む
 *   - #930 のタグ整備 (smoke / regression / endurance) 完了後は `@endurance` に移す
 *   - default 実行から除外するため env gate `HARMONY_E2E_VITE_STRESS=1` が必要
 *
 * ## 手動実行
 *
 * ```bash
 * cd frontend
 * HARMONY_E2E_VITE_STRESS=1 npx playwright test vite-stress.spec.ts
 * ```
 *
 * ## 観測ポイント
 *
 * 1. 各 cycle 後に `GET http://localhost:5173/__vite_ping` (Vite client の ping endpoint)
 *    で Vite プロセスの生存確認
 * 2. backend (port 5179) も同時に生存確認 (Vite と独立 process だが parallel に落ちる場合
 *    別の真因仮説が立つ)
 * 3. 落ちたら Playwright fail と同時に Vite stderr が `~/.npm/_logs/` 等にダンプされている
 *    可能性があるので調査
 *
 * ## 関連
 *
 *   - 親 ISSUE: #992
 *   - 関連 commit: 9707002 / 8ae5305 (#980-A の click 経路改善で症状消失)
 *   - upstream: vitejs/vite#11991 / PR #12007 (ws lib の error が unhandled で crash)
 *   - 解説 doc: ../../docs/spec/e2e-vite-stability.md
 */

import { test, expect, type BrowserContext } from "@playwright/test";
import { isMcpRunning } from "./helpers/realWorkspace";

const STRESS_ENABLED = process.env.HARMONY_E2E_VITE_STRESS === "1";
const VITE_PORT = parseInt(process.env.VITE_PORT ?? "5173", 10);
const VITE_BASE = `http://localhost:${VITE_PORT}`;
const BACKEND_BASE = `http://localhost:5179`;

const CYCLES = parseInt(process.env.HARMONY_E2E_VITE_STRESS_CYCLES ?? "20", 10);
const PARALLEL_CONTEXTS = parseInt(process.env.HARMONY_E2E_VITE_STRESS_PARALLEL ?? "5", 10);

/**
 * Vite dev server が応答するか確認する。クラッシュ後は connection refused になる。
 * `/__vite_ping` は Vite が必ず提供する内部 endpoint。
 */
async function pingVite(): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(`${VITE_BASE}/__vite_ping`, {
      signal: AbortSignal.timeout(3000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

test.describe("Vite dev server multi-context stress (#992)", () => {
  test.skip(!STRESS_ENABLED, "HARMONY_E2E_VITE_STRESS=1 で明示有効化したときのみ実行");
  test.skip((_, testInfo) => testInfo.project.name !== "chromium", "chromium のみ");
  test.beforeAll(async () => {
    const mcp = await isMcpRunning();
    test.skip(!mcp, "backend (port 5179) が起動していません");
    const vite = await pingVite();
    test.skip(!vite.ok, `Vite (port ${VITE_PORT}) が起動していません: ${vite.error ?? vite.status}`);
  });

  test("多重 context で WS を急速 open/close しても Vite/backend が生存する", async ({ browser }) => {
    test.setTimeout(180_000);

    const failures: Array<{ cycle: number; reason: string }> = [];
    let crashedAtCycle: number | null = null;

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const contexts: BrowserContext[] = [];
      try {
        // 並列に context を open
        await Promise.all(
          Array.from({ length: PARALLEL_CONTEXTS }, async () => {
            const ctx = await browser.newContext();
            contexts.push(ctx);
            const page = await ctx.newPage();
            // Vite + mcpBridge WS を確立。ルート画面は wsBridge connect だけ呼ぶので軽量
            await page.goto(VITE_BASE, { waitUntil: "domcontentloaded", timeout: 10_000 });
            // HMR socket / mcpBridge WS が確立するまで短く待つ
            await page.waitForTimeout(200);
          }),
        );
      } catch (e) {
        failures.push({ cycle, reason: `open: ${e instanceof Error ? e.message : String(e)}` });
      } finally {
        // 並列に ungraceful に閉じる (close handshake 不完了で WS が異常終了することを狙う)
        await Promise.all(contexts.map((ctx) => ctx.close().catch(() => undefined)));
      }

      // 各 cycle 後に Vite 生存確認
      const probe = await pingVite();
      if (!probe.ok) {
        crashedAtCycle = cycle;
        failures.push({
          cycle,
          reason: `Vite ping failed: ${probe.error ?? `HTTP ${probe.status}`}`,
        });
        break;
      }
    }

    // backend も同時に生存しているか
    const backendAlive = await fetch(`${BACKEND_BASE}/health`, {
      signal: AbortSignal.timeout(3000),
    })
      .then((r) => r.ok)
      .catch(() => false);

    if (crashedAtCycle !== null) {
      // 再現した: 詳細ログを残す。受入基準「再現条件特定」のための情報源
      console.error(
        `[#992] Vite crash 再現: cycle ${crashedAtCycle} / ${CYCLES}, backend alive=${backendAlive}`,
      );
      console.error(JSON.stringify(failures, null, 2));
    }

    expect(crashedAtCycle, "Vite が cycle 中に crash した").toBeNull();
    expect(failures, `cycle 中に何らかの fail: ${JSON.stringify(failures)}`).toHaveLength(0);
    expect(backendAlive, "backend (5179) も同時に死んだ場合は別の真因").toBe(true);
  });
});
