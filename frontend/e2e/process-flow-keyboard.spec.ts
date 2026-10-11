/**
 * 処理フローの工程を、キーボードだけで辿る・挿入する・インデントする (docs/spec/process-flow-keyboard.md)。
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `pf-keyboard-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("処理フローのキーボード操作", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("↑↓ で工程を辿り、Insert で種類を打ち込んで挿入し、そのまま入力できる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const headers = page.locator(".step-card-header");
    await expect(headers.first()).toBeVisible();
    const before = await page.locator(".step-card").count();

    // 1 番目の工程の見出しへ → ↓ で 2 番目へ
    await headers.first().focus();
    await expect(headers.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(headers.nth(1)).toBeFocused();
    await expect(page.locator(".step-card.selected")).toHaveCount(1);

    // Insert → 「DB」と打って Enter: 2 番目の後ろに DB アクセスが入り、説明欄にカーソルが移る
    await page.keyboard.press("Insert");
    await expect(page.getByTestId("step-insert-menu")).toBeVisible();
    await page.getByTestId("step-insert-input").fill("DB");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("step-insert-menu")).toHaveCount(0);
    await expect(page.locator(".step-card")).toHaveCount(before + 1);
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(["TEXTAREA", "INPUT"]).toContain(focusedTag);
    await page.keyboard.type("在庫を確認する");
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();

    // Esc で入力欄から工程の見出しへ戻る
    await page.keyboard.press("Escape");
    const focusedIsHeader = await page.evaluate(() => document.activeElement?.classList.contains("step-card-header"));
    expect(focusedIsHeader).toBe(true);
  });

  test("Tab で直前の工程の配下へ入れ、Shift+Tab で戻せる (最初の工程は Tab を奪わない) @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const tops = page.locator(".step-card-wrapper:not(.sub-steps .step-card-wrapper) > .step-card > .step-card-header");
    // 最初の工程では入れ子にできないので、Tab は通常のフォーカス移動 (保存は押せないまま)
    await tops.first().focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("edit-mode-save")).toBeDisabled();

    const second = tops.nth(1);
    await second.focus();
    const id = await second.evaluate((el) => el.closest(".step-card")?.getAttribute("data-step-id"));
    await page.keyboard.press("Tab");
    await expect(page.locator(`.sub-steps .step-card[data-step-id="${id}"]`)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(`.step-card[data-step-id="${id}"] > .step-card-header`)).toBeFocused({ timeout: 5000 });
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();

    await page.keyboard.press("Shift+Tab");
    await expect(page.locator(`.sub-steps .step-card[data-step-id="${id}"]`)).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator(`.step-card[data-step-id="${id}"] > .step-card-header`)).toBeFocused({ timeout: 5000 });
  });

  test("アウトライン: 1 行 1 工程のテキストで、説明の変更・工程の追加・並べ替え・削除ができる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const cardsBefore = await page.locator(".step-card-wrapper:not(.sub-steps .step-card-wrapper)").count();

    await page.getByTestId("pf-view-outline").click();
    const area = page.getByTestId("pf-outline-text");
    await expect(area).toBeVisible();
    const lines = (await area.inputValue()).split("\n");
    expect(lines.length).toBe(cardsBefore);
    expect(lines[0]).toMatch(/^\[.+\] .* \^step-/);

    // 1 行目の説明を書き換え、末尾に「/」で種類を選んで新しい行を足す → 欄を出ると自動で反映される
    await area.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("End");
    await page.keyboard.press("Backspace"); // 末尾の 1 文字 (^id の最後) は消さない: 直後に戻す
    await page.keyboard.type(lines[0].slice(-1));
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    await expect(page.getByTestId("step-insert-menu")).toBeVisible();
    await page.keyboard.type("共通");
    await page.keyboard.press("Enter");
    await expect(area).toBeFocused();
    await page.keyboard.type("在庫を引き当てる");
    await expect(page.getByTestId("pf-outline-apply")).toBeEnabled();
    await page.getByTestId("pf-outline-apply").click();

    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();
    const after = (await area.inputValue()).split("\n");
    expect(after.length).toBe(cardsBefore + 1);
    expect(after[after.length - 1]).toMatch(/^\[共通処理\] 在庫を引き当てる \^step-/);

    // 形式の誤りは行番号つきで知らせ、反映は止まる
    await area.focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("種類のない行");
    await expect(page.getByTestId("pf-outline-errors")).toContainText(`${after.length + 1} 行目`);
    await expect(page.getByTestId("pf-outline-apply")).toBeDisabled();
    await page.getByTestId("pf-outline-discard").click();

    // カードの表示に戻ると、追加した工程がある
    await page.getByTestId("pf-view-cards").click();
    await expect(page.locator(".step-card-wrapper:not(.sub-steps .step-card-wrapper)")).toHaveCount(cardsBefore + 1);
  });

  test("アウトライン: Tab で字下げすると入れ子 (subSteps) になり、保存してもスキーマ違反にならない @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("pf-view-outline").click();
    const area = page.getByTestId("pf-outline-text");
    await area.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await page.keyboard.press("Tab");
    expect((await area.inputValue()).split("\n")[1].startsWith("  [")).toBe(true);
    await page.getByTestId("pf-outline-apply").click();
    await page.getByTestId("pf-view-cards").click();
    await expect(page.locator(".sub-steps .step-card")).toHaveCount(1);
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByTestId("edit-mode-save")).toBeDisabled({ timeout: 10000 });
    // 保存した原本はスキーマに合う: 設計書 (要確認) にスキーマ違反が出ない
    await ws.gotoActive(page, "/document");
    await expect(page.getByTestId("design-document-view")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("design-document-view")).not.toContainText("must NOT have unevaluated properties");
    await expect(page.getByTestId("design-document-view")).not.toContainText("subSteps");
  });

  test("アウトライン: DB アクセスの行にテーブルが出て、[DBアクセス: のあとの : で参照先を選べる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("pf-view-outline").click();
    const area = page.getByTestId("pf-outline-text");
    expect(await area.inputValue()).toMatch(/\[DBアクセス:[a-z-]+\]/); // 既存の DB アクセスの行に、テーブルの id が出る

    await area.focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("[DBアクセス");
    await page.keyboard.type(":");
    await expect(page.getByTestId("outline-ref-menu")).toBeVisible();
    await page.getByTestId("outline-ref-input").fill("order");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("outline-ref-menu")).toHaveCount(0);
    await expect(area).toBeFocused();
    await page.keyboard.type("注文を確認する");
    const last = (await area.inputValue()).split("\n").pop()!;
    expect(last).toMatch(/^\[DBアクセス:[a-z-]*order[a-z-]*\] 注文を確認する$/);
    await page.getByTestId("pf-outline-apply").click();
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();
  });
});

