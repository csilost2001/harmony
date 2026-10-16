/**
 * 式・条件の欄の、書き間違いの指摘・平文の言い直し (#82) と、参照の打ち間違いの先回り (#100)。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `expression-hints-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("式・条件の指摘", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("実行条件 (runIf): 書き間違いを指摘し、直すと消える。正しい条件は平文で言い直す。参照の打ち間違いには近い名前を示す", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const headers = page.locator(".step-card-header");
    await expect(headers.first()).toBeVisible();
    await headers.first().focus();
    await page.keyboard.press("Enter"); // 工程を開く
    const field = page.locator('[data-field-path="runIf"]').first();
    await field.scrollIntoViewIfNeeded();
    const input = field.locator("input");
    await expect(input).toBeVisible();

    // 書き間違い: 演算子の後に値が無い → フォーカスを外すと、指摘が出る
    await input.fill("@inputs.amount >=");
    await input.blur();
    await expect(field.getByTestId("reference-hint")).toContainText("演算子 >= の後に値がありません");
    await expect(input).toHaveAttribute("aria-invalid", "true");

    // 直す: 平文の言い直しが出る (指摘は消える)
    await input.fill("@inputs.amount >= 10000 && @inputs.status !== 'locked'");
    await input.blur();
    await expect(field.getByTestId("reference-hint")).toHaveCount(0);
    await expect(field.getByTestId("condition-preview")).toContainText("inputs.amount が 10000 以上");
    await expect(field.getByTestId("condition-preview")).toContainText("かつ inputs.status が locked と異なる のとき");

    // 参照の打ち間違い: 規約の名前 (@conv.regex.postalCode) の 1 文字違い → 近い名前と、1 クリックで直す
    await input.fill("@conv.regex.postalcdoe");
    await input.blur();
    await expect(field.getByTestId("reference-hint")).toContainText("近い名前: postalCode");
    await field.getByTestId("field-hint-fix").click();
    await expect(input).toHaveValue("@conv.regex.postalCode");
    await expect(field.getByTestId("reference-hint")).toHaveCount(0);
  });
});
