/**
 * 処理フローの「流れ」表示の判定表 (ISSUE #1530 第 3 弾) の E2E。
 *
 * - ひな型「条件の組み合わせで分ける」を置く → 判定表が開く → 条件の行を足す → マスを ○ × にする → 保存 → 原本の道の条件の式になる
 * - 閲覧中も、判定表で条件を見られる (直す窓口は無い)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `process-flow-story-decision-${Date.now()}`;
let ws: OpenedWorkspace;
const SAVE = (page: Page) => page.locator('[data-testid="edit-mode-save"]:visible');
const START = (page: Page) => page.locator('[data-testid="edit-mode-start"]:visible');

async function readFlow(): Promise<{ actions: Array<{ steps: Array<Record<string, unknown>> }> }> {
  return JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony", "process-flows", "order-confirm.json"), "utf-8"));
}

async function addRow(page: Page, prop: string, op: string, value: string) {
  const dt = page.getByTestId("pfs-dt").last();
  await dt.getByTestId("pfs-dt-add-row").click();
  const pop = page.getByTestId("pfs-popover");
  await pop.getByLabel("値の元").selectOption("@inputs");
  await pop.getByLabel("項目").fill(prop);
  await pop.getByLabel("比べ方").selectOption(op);
  if (value) await pop.getByLabel("比べる値").fill(value);
  await pop.getByTestId("pfs-dt-row-apply").click();
}

test.describe("処理フローの「流れ」表示: 判定表 (#1530 第 3 弾)", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => {
    await cleanupRealWorkspaces([KEY]);
  });

  test("判定表で組み合わせを決めて保存すると、各道の条件の式として原本に入る", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("pf-view-story").click();
    await START(page).click();
    await expect(SAVE(page)).toBeVisible({ timeout: 10000 });
    const before = (await readFlow()).actions[0].steps.length;

    await page.getByTestId("pfs-gap-add").last().click({ force: true });
    await page.getByTestId("pfs-template-decision").click();
    await expect(page.getByTestId("pfs-dt").last()).toBeVisible();

    await addRow(page, "paymentTerm", "==", "prepaid");
    await addRow(page, "amount", ">", "1000000");
    const cells = page.getByTestId("pfs-dt").last().getByTestId("pfs-dt-cell");
    // 列は 道 A / 道 B / それ以外(セルなし)。行 2 つ → 各行 2 マス: [行1 A, 行1 B, 行2 A, 行2 B]
    await cells.nth(0).click(); // 行1 A ○
    await cells.nth(1).click(); // 行1 B ○
    await cells.nth(2).click(); // 行2 A ○
    await cells.nth(3).click(); // 行2 B ○
    await cells.nth(3).click(); // 行2 B ×
    await expect(page.getByTestId("pfs-dt").last()).toContainText("1000000 より大きい");
    await page.screenshot({ path: "../.tmp/screenshots/story-decision-table.png" });

    await SAVE(page).click();
    await expect(page.getByTestId("edit-mode-save-status").first()).toContainText("原本と同じ", { timeout: 10000 });
    const steps = (await readFlow()).actions[0].steps;
    expect(steps.length).toBe(before + 1);
    const b = steps.at(-1) as unknown as { kind: string; branches: Array<{ condition: { expression: string } }> };
    expect(b.kind).toBe("branch");
    expect(b.branches[0].condition.expression).toBe("@inputs.paymentTerm == 'prepaid' && @inputs.amount > 1000000");
    expect(b.branches[1].condition.expression).toBe("@inputs.paymentTerm == 'prepaid' && @inputs.amount <= 1000000");
  });

  test("閲覧中: 判定表で条件を見られ、直す窓口は出ない", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("pf-view-story").click();
    await expect(page.getByTestId("process-flow-story")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("pfs-dt-toggle").last().click();
    const dt = page.getByTestId("pfs-dt").last();
    await expect(dt).toContainText("paymentTerm");
    await expect(dt.getByTestId("pfs-dt-cell")).toHaveCount(0);
    await expect(dt.getByTestId("pfs-dt-add-row")).toHaveCount(0);
  });
});
