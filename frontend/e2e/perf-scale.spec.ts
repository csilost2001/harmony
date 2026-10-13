/**
 * さらに大きな規模の性能の目安 (通常の回帰には含めない。@regression なし):
 *   - retail を 100 倍 (画面 約 1,500 / 処理フロー 約 750 / テーブル 約 850。計約 2,900 件)
 *   - 工程が 1,000 ある処理フロー 1 件
 * 実行: cd frontend && npx playwright test e2e/perf-scale.spec.ts   (時間は標準出力。上限は、極端な劣化を見つけるための余裕のある値)
 * backend 側の時間は、`npx tsx scripts/dev/bench-backend.mts <ワークスペース>` でも測れる。
 */
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `perf-scale-${Date.now()}`;
const OUT = ".tmp/perf/scale-x100-huge";
let ws: OpenedWorkspace;
const BUDGET_MS = 20_000;

test.describe("大きな規模の性能", () => {
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    test.skip(!(await isMcpRunning()), "backend 未起動");
    execFileSync("node", ["scripts/dev/make-large-workspace.mjs", "examples/retail", OUT, "100", "--huge-flow", "1000"], { cwd: "..", stdio: "ignore" });
    ws = await setupTestWorkspace({ key: KEY, fromExample: `../${OUT}` });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

  const pages: Array<{ name: string; path: string; ready: string }> = [
    { name: "画面一覧 (約 1,500 件)", path: "/screen/list", ready: '[data-testid="data-list-row"], [data-testid="data-list-card"]' },
    { name: "テーブル一覧 (約 850 件)", path: "/table/list", ready: '[data-testid="data-list-row"], [data-testid="data-list-card"]' },
    { name: "処理フロー一覧 (約 750 件)", path: "/process-flow/list", ready: '[data-testid="data-list-row"], [data-testid="data-list-card"]' },
    { name: "設計書 (約 2,900 件)", path: "/document", ready: '[data-testid="design-document-view"]' },
    { name: "ダッシュボード", path: "/", ready: '.dashboard-view, [data-testid="dashboard"], .panel-unsaved-drafts' },
    { name: "工程 1,000 の処理フロー", path: "/process-flow/edit/huge-flow", ready: ".step-card" },
  ];
  for (const p of pages) {
    test(`${p.name} が ${BUDGET_MS / 1000} 秒以内に開く`, async ({ page }) => {
      test.setTimeout(120_000);
      const t0 = Date.now();
      await ws.gotoActive(page, p.path);
      await page.locator(p.ready).first().waitFor({ timeout: BUDGET_MS * 2 });
      const ms = Date.now() - t0;
      const rows = await page.locator('[data-testid="data-list-row"], [data-testid="data-list-card"], .step-card').count();
      console.log(`[perf-scale] ${p.name}: ${ms} ms (描画した行・工程 ${rows})`);
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }
});
