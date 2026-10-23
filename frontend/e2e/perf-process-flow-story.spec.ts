/**
 * 「流れ」表示の、大きな処理 (既定は約 360 工程。PERF_STORY_REPEAT で増やせる) での速さ (ISSUE #1530)。回帰には含めない (時間の目安を出す)。
 *
 * 実行: cd frontend && npx playwright test e2e/perf-process-flow-story.spec.ts
 * 測るもの: 流れを開くまで / 編集を始めるまで / 1 回の操作 (↑) の描き直し / 判定表を開くまで / 画面の固まり (long task) の最大
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

const KEY = `perf-pf-story-${Date.now()}`;
let ws: OpenedWorkspace;

function bigSteps(): unknown[] {
  const steps: unknown[] = [];
  let n = 0;
  const id = () => `step-${String(++n).padStart(4, "0")}`;
  // 既定は約 360 工程。PERF_STORY_REPEAT=60 で約 1080 工程 (提案 93: 1000 工程以上の確認)
  const repeat = Math.max(1, Number(process.env.PERF_STORY_REPEAT) || 20);
  for (let i = 0; i < repeat; i++) {
    steps.push({ id: id(), kind: "dbAccess", heading: i % 4 === 0 ? `区切り ${i}` : undefined, description: `取得 ${i}`, tableId: "order", operation: "SELECT", sql: `SELECT id, name FROM t${i} WHERE id = @inputs.k`, outputBinding: { name: `row${i}`, label: `行${i}` } });
    steps.push({ id: id(), kind: "branch", description: "無ければ返す", branches: [{ id: `br-${i}a`, code: "A", condition: { kind: "expression", expression: `@row${i} == null` }, steps: [{ id: id(), kind: "return", description: "404", responseId: "404-nf" }] }], elseBranch: { id: `br-${i}b`, code: "B", steps: [] } });
    steps.push({
      id: id(), kind: "branch", description: "区分で分ける",
      branches: [0, 1, 2].map((k) => ({ id: `br-${i}-${k}`, code: "ABC"[k], condition: { kind: "expression", expression: `@inputs.t == 'x${k}' && @inputs.amount > ${k * 100} || @inputs.vip == true` }, steps: [{ id: id(), kind: "compute", description: `計算 ${k}`, expression: "1+1", outputBinding: { name: `c${i}${k}` } }, { id: id(), kind: "log", description: "記録", level: "info" }] })),
      elseBranch: { id: `br-${i}-e`, code: "X", steps: [{ id: id(), kind: "log", description: "その他", level: "info" }] },
    });
    steps.push({ id: id(), kind: "loop", description: `明細 ${i}`, loopKind: "collection", collectionSource: "@inputs.lines", collectionItemName: `line${i}`, steps: Array.from({ length: 5 }, (_, k) => ({ id: id(), kind: "compute", description: `行の計算 ${k}`, expression: `@line${i}.q * ${k}`, outputBinding: { name: `s${i}${k}`, operation: "accumulate", initialValue: 0 } })) });
    steps.push({ id: id(), kind: "validation", description: "確かめる", fieldErrorsVar: `fe${i}`, rules: [{ field: "a", type: "required" }, { field: "b", type: "maxLength", length: 10 }] });
  }
  return steps;
}

test.describe("流れ: 大きな処理の速さ (回帰に含めない)", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
    const file = path.join(ws.workspacePath, "harmony", "process-flows", "order-confirm.json");
    const flow = JSON.parse(await fs.readFile(file, "utf-8"));
    const a = flow.actions[0];
    a.steps = bigSteps();
    a.inputs = [{ name: "k", type: "integer" }, { name: "t", type: "string" }, { name: "amount", type: "integer" }, { name: "vip", type: "boolean" }, { name: "lines", type: { kind: "array", itemType: "string" } }];
    await fs.writeFile(file, JSON.stringify(flow, null, 2));
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });

  test("流れを開く・編集する・判定表を開くまでの時間", async ({ page }) => {
    test.setTimeout(120000);
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.locator('[data-testid="pf-view-story"]:visible').waitFor({ timeout: 30000 });
    // 画面の固まり (50ms 以上の処理) を記録する
    await page.evaluate(() => {
      (window as unknown as { __long: number[] }).__long = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as unknown as { __long: number[] }).__long.push(e.duration); }).observe({ entryTypes: ["longtask"] });
    });
    const t0 = Date.now();
    await page.locator('[data-testid="pf-view-story"]:visible').click();
    await expect(page.getByTestId("process-flow-story")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("pfs-section").first()).toBeVisible();
    const openMs = Date.now() - t0;
    const rows = await page.locator("[data-step-id]").count();

    const t1 = Date.now();
    await page.locator('[data-testid="edit-mode-start"]:visible').click();
    await expect(page.getByTestId("pfs-gap-add").first()).toBeAttached({ timeout: 30000 });
    const editMs = Date.now() - t1;

    // 1 回の操作 (↑ ボタン) の描き直し: 押して、下書きが変わるまで
    const down = page.getByTestId("pfs-down").first();
    const t2 = Date.now();
    await down.click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const opMs = Date.now() - t2;

    // 判定表を開く
    const toggle = page.getByTestId("pfs-dt-toggle").nth(5);
    await toggle.scrollIntoViewIfNeeded();
    const t3 = Date.now();
    await toggle.click();
    await expect(page.getByTestId("pfs-dt").first()).toBeVisible();
    const dtMs = Date.now() - t3;

    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    const maxLong = long.length ? Math.max(...long) : 0;
    console.info(`[perf] 要素 ${rows} 行: 流れを開く ${openMs}ms / 編集開始 ${editMs}ms / 1 操作 ${opMs}ms / 判定表 ${dtMs}ms / 最大の固まり ${maxLong.toFixed(0)}ms (${long.length} 回)`);
    // 目安: どれも数秒以内 (開発サーバ・共有の環境なので、緩く)
    expect(openMs).toBeLessThan(15000);
    expect(editMs).toBeLessThan(15000);
    expect(opMs).toBeLessThan(6000);
    expect(dtMs).toBeLessThan(6000);
  });
});
