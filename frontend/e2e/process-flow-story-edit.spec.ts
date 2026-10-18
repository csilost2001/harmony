/**
 * 処理フローの「流れ」表示で、その場で直す (ISSUE #1530 第 2 弾) の E2E。
 *
 * - 行の間の「＋」から、ひな型 (ガード) を足す → 条件を、選びで決める (式を書かない) → 保存 → 原本の JSON に入る
 * - 1 つ上へ動かす / 消す / 見出しを付ける・書き換える → 保存 → 原本に反映
 * - 閲覧中は、直す窓口が出ない
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `process-flow-story-edit-${Date.now()}`;
let ws: OpenedWorkspace;
const SAVE = (page: Page) => page.locator('[data-testid="edit-mode-save"]:visible');
const START = (page: Page) => page.locator('[data-testid="edit-mode-start"]:visible');

async function readFlow(): Promise<{ actions: Array<{ steps: Array<Record<string, unknown>> }> }> {
  return JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony", "process-flows", "order-confirm.json"), "utf-8"));
}
async function save(page: Page) {
  await SAVE(page).click();
  await expect(page.getByTestId("edit-mode-save-status").first()).toContainText("原本と同じ", { timeout: 10000 });
}

test.describe("処理フローの「流れ」表示で、その場で直す (#1530 第 2 弾)", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => {
    await cleanupRealWorkspaces([KEY]);
  });

  test("閲覧中は、足す・消す・動かすの窓口が出ない", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("pf-view-story").click();
    await expect(page.getByTestId("process-flow-story")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("pfs-gap-add")).toHaveCount(0);
    await expect(page.getByTestId("pfs-delete")).toHaveCount(0);
  });

  test("ガードを足して、条件を選びで決め、保存すると原本に入る。動かす・消す・見出しも", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("pf-view-story").click();
    await START(page).click();
    await expect(SAVE(page)).toBeVisible({ timeout: 10000 });
    const before = (await readFlow()).actions[0].steps.length;

    // 末尾の「＋」から、ガードを足す
    await page.getByTestId("pfs-gap-add").last().click({ force: true });
    await page.getByTestId("pfs-template-guard").click();
    // 条件の窓が、そのまま開く: 「カートの明細」が「ない」なら
    const pop = page.getByTestId("pfs-popover");
    await expect(pop).toContainText("この道に進む条件");
    await pop.getByLabel("値の元").selectOption({ label: "カートの明細 (@cartItems)" });
    await pop.getByLabel("比べ方").selectOption("null");
    await expect(pop.getByTestId("pfs-cond-preview")).toContainText("@cartItems == null");
    await pop.getByTestId("pfs-cond-apply").click();
    await expect(page.getByTestId("pfs-guard").last()).toContainText("が ない");
    await save(page);

    let steps = (await readFlow()).actions[0].steps;
    expect(steps.length).toBe(before + 1);
    const guard = steps.at(-1) as { id: string; kind: string; branches: Array<{ condition: { expression: string }; steps: Array<{ kind: string }> }> };
    const addedId = guard.id;
    expect(guard.kind).toBe("branch");
    expect(guard.branches[0].condition.expression).toBe("@cartItems == null");
    expect(guard.branches[0].steps[0].kind).toBe("return");

    // 1 つ上へ動かして、保存
    const guardRow = page.getByTestId("pfs-guard").last();
    await guardRow.hover();
    await guardRow.getByTestId("pfs-up").click();
    await save(page);
    steps = (await readFlow()).actions[0].steps;
    expect(steps.at(-2)?.kind).toBe("branch");
    expect(steps.at(-1)?.kind).toBe("return");

    // 見出しを付けて書き換える (最後の工程に)
    const last = page.locator('[data-testid="pfs-row"]').last();
    await last.hover();
    await last.getByTestId("pfs-add-heading").click();
    await page.getByRole("button", { name: "見出しを書き換える" }).last().click();
    await page.getByRole("textbox", { name: "見出しを書き換える" }).fill("仕上げ");
    await page.getByRole("textbox", { name: "見出しを書き換える" }).press("Enter");
    await save(page);
    steps = (await readFlow()).actions[0].steps;
    expect(steps.at(-1)?.heading).toBe("仕上げ");

    // 足したガードを、消して保存すると、もとの本数に戻る
    const g2 = page.getByTestId("pfs-guard").last();
    await g2.hover();
    await g2.getByTestId("pfs-delete").click();
    await save(page);
    steps = (await readFlow()).actions[0].steps;
    expect(steps.length).toBe(before);
    expect(steps.some((s) => s.id === addedId)).toBe(false);
  });
});
