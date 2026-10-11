/**
 * 大きなプロジェクト (retail を 20 倍: 画面 約 300 / 処理フロー 約 150 / テーブル 約 170) での、画面の開きやすさの目安。
 * 通常の回帰には含めない (@regression なし)。実行: cd frontend && npx playwright test e2e/perf-large-project.spec.ts
 * 時間は標準出力に出す。上限は、極端な劣化 (数倍) を見つけるための余裕のある値。
 */
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `perf-large-${Date.now()}`;
const OUT = ".tmp/perf/retail-x20";
let ws: OpenedWorkspace;

const BUDGET_MS = 8000;

test.describe("大きなプロジェクトの性能", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    execFileSync("node", ["scripts/dev/make-large-workspace.mjs", "examples/retail", OUT, "20"], { cwd: "..", stdio: "ignore" });
    ws = await setupTestWorkspace({ key: KEY, fromExample: `../${OUT}` });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

  const pages: Array<{ name: string; path: string; ready: string; min?: number }> = [
    { name: "画面一覧", path: "/screen/list", ready: '[data-testid="data-list-row"], [data-testid="data-list-card"]' },
    { name: "テーブル一覧", path: "/table/list", ready: '[data-testid="data-list-row"], [data-testid="data-list-card"]' },
    { name: "処理フロー一覧", path: "/process-flow/list", ready: '[data-testid="data-list-row"], [data-testid="data-list-card"]' },
    { name: "ER 図", path: "/table/er", ready: ".react-flow__node" },
    { name: "画面フロー", path: "/screen/flow", ready: ".react-flow__node" },
    { name: "設計書", path: "/document", ready: '[data-testid="design-document-view"]' },
    { name: "ダッシュボード", path: "/", ready: ".dashboard-view, [data-testid=\"dashboard\"], .panel-unsaved-drafts, main" },
  ];

  for (const p of pages) {
    test(`${p.name} が ${BUDGET_MS / 1000} 秒以内に開く`, async ({ page }) => {
      const t0 = Date.now();
      await ws.gotoActive(page, p.path);
      await page.locator(p.ready).first().waitFor({ timeout: BUDGET_MS * 2 });
      const ms = Date.now() - t0;
      console.log(`[perf] ${p.name}: ${ms} ms`);
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }

  test("Ctrl+K の絞り込みが、1 文字ごとに素早く返る", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+k");
    const input = page.getByTestId("quick-open-input");
    await expect(input).toBeVisible();
    const t0 = Date.now();
    await input.pressSequentially("注文確定", { delay: 0 });
    await expect(page.getByTestId("quick-open-list").locator("li").first()).toBeVisible();
    const ms = Date.now() - t0;
    console.log(`[perf] Ctrl+K 4 文字入力 + 結果表示: ${ms} ms`);
    expect(ms).toBeLessThan(3000);
  });

  test("Ctrl+K の本文検索 (説明・カラム・工程) が、大きなプロジェクトでも数秒以内に返る", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+k");
    const t0 = Date.now();
    await page.getByTestId("quick-open-input").fill("サロゲートキー");
    await expect(page.getByTestId("quick-open-content-head")).toBeVisible({ timeout: 15000 });
    const ms = Date.now() - t0;
    console.log(`[perf] Ctrl+K 本文検索 (約 600 件): ${ms} ms`);
    expect(ms).toBeLessThan(5000);
  });

  // 設計ごとに問い合わせる (N+1) と、大きなプロジェクトでは数千回の往復になり、サーバが他の操作に応えられなくなる。
  // 主要画面の問い合わせの総数が、設計の数 (約 600) に比例していないことを確かめる
  const COUNT_BUDGET = 150;
  for (const route of ["/", "/screen/list", "/table/list", "/process-flow/list", "/table/er", "/document"]) {
    test(`${route} を開いたときの問い合わせの数が、設計の数に比例しない`, async ({ page }) => {
      await page.addInitScript(() => {
        const W = window as unknown as { __rpcCount: number };
        W.__rpcCount = 0;
        const Orig = window.WebSocket;
        window.WebSocket = class extends Orig {
          constructor(u: string | URL, p?: string | string[]) {
            super(u, p);
            const send = this.send.bind(this);
            this.send = (d: string | ArrayBufferLike | Blob | ArrayBufferView) => { try { if (JSON.parse(String(d)).method) W.__rpcCount++; } catch { /* */ } send(d); };
          }
        } as typeof WebSocket;
      });
      await ws.gotoActive(page, route);
      await page.waitForTimeout(5000);
      const n = await page.evaluate(() => (window as unknown as { __rpcCount: number }).__rpcCount);
      console.log(`[perf] ${route}: 問い合わせ ${n} 回`);
      expect(n).toBeLessThan(COUNT_BUDGET);
    });
  }
});

