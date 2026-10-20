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
// 保存する試験ごとに、別のワークスペースを使う (同じファイルを続けて保存すると、「別の編集セッションで更新されています」の確認が出るため)
const KEY2 = `${KEY}-rules`;
let ws: OpenedWorkspace;
let ws2: OpenedWorkspace;
const SAVE = (page: Page) => page.locator('[data-testid="edit-mode-save"]:visible');
const START = (page: Page) => page.locator('[data-testid="edit-mode-start"]:visible');

async function readFlow(w: OpenedWorkspace = ws): Promise<{ actions: Array<{ steps: Array<Record<string, unknown>> }> }> {
  return JSON.parse(await fs.readFile(path.join(w.workspacePath, "harmony", "process-flows", "order-confirm.json"), "utf-8"));
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
    ws2 = await setupTestWorkspace({ key: KEY2, fromExample: "retail" });
  });
  test.afterAll(async () => {
    await cleanupRealWorkspaces([KEY, KEY2]);
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

  test("入力チェックのルールをその場で足して保存すると原本に入る。消したあとは「元に戻す」で戻せる", async ({ page }) => {
    await ws2.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("pf-view-story").click();
    await START(page).click();
    await expect(SAVE(page)).toBeVisible({ timeout: 10000 });
    const before = (await readFlow(ws2)).actions[0].steps.length;

    // 入力チェックを足し、ルールを 2 つ入れる
    await page.getByTestId("pfs-gap-add").last().click({ force: true });
    await page.getByTestId("pfs-template-validation").click();
    await page.getByTestId("pfs-edit-rules").last().click();
    const pop = page.getByTestId("pfs-popover");
    await pop.getByTestId("pfs-rule-add").click();
    await pop.getByLabel("対象の入力").first().fill("orderNote");
    await pop.getByLabel("ルールの種類").first().selectOption("maxLength");
    await pop.getByLabel("長さ").first().fill("200");
    await pop.getByLabel("メッセージ").first().fill("備考は 200 文字までです");
    await expect(pop.getByTestId("pfs-rules-apply")).toBeEnabled();
    await pop.getByTestId("pfs-rules-apply").click();
    await expect(page.getByText(/最大 200/).first()).toBeVisible();

    // 消す → 通知の「元に戻す」で戻る
    await page.getByTestId("pfs-delete").last().click({ force: true });
    await expect(page.getByTestId("toast-undo")).toBeVisible();
    await page.getByTestId("toast-undo").click();
    await expect(page.getByText(/最大 200/).first()).toBeVisible();

    await SAVE(page).click();
    await expect(page.getByTestId("edit-mode-save-status").first()).toContainText("原本と同じ", { timeout: 10000 });
    const steps = (await readFlow(ws2)).actions[0].steps;
    expect(steps.length).toBe(before + 1);
    const v = steps.at(-1) as unknown as { kind: string; rules: Array<Record<string, unknown>> };
    expect(v.kind).toBe("validation");
    expect(v.rules.at(-1)).toMatchObject({ field: "orderNote", type: "maxLength", length: 200, message: "備考は 200 文字までです" });
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
