/**
 * workspace-default-path.spec.ts (#755)
 *
 * workspaces/ トップレベル新設に伴うデフォルトパスのUX確認。
 *
 * カバー範囲:
 *  - AddWorkspaceDialog に workspaces/ 起点のプレースホルダ / ヒントテキストが表示される
 *  - 既存「任意フォルダ open」機能が regression していない (ダイアログが開く / キャンセルで閉じる)
 *  - WorkspaceSelectView の「新しくワークスペースを追加」ボタンがダイアログを開く
 *
 * 前提: dev サーバー起動済み (playwright.config.ts の webServer で自動起動)
 *       MCP サーバーは不要 (UI のダイアログ構造のみ検証)
 */

import { test, expect, type Page } from "@playwright/test";

async function setupWithNoWorkspace(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    window.alert = () => {};
    window.confirm = () => false;
  });
}

test.describe("AddWorkspaceDialog — デフォルトパスのヒント (#755)", () => {
  test("WorkspaceListView の「追加」ボタンでダイアログが開き workspaces/ ヒントが表示される", async ({ page }) => {
    await setupWithNoWorkspace(page);
    await page.goto("/workspace/list");
    await expect(page).toHaveURL("/workspace/list");

    // 追加ボタンをクリック
    const addBtn = page.locator("button", { hasText: "追加" }).first();
    await addBtn.click();

    // ダイアログが表示されること
    await expect(page.locator(".tbl-modal")).toBeVisible();

    // フォルダパス入力欄のプレースホルダに workspaces/ が含まれること
    const input = page.locator(".tbl-modal input[type='text']").first();
    await expect(input).toBeVisible();
    const placeholder = await input.getAttribute("placeholder");
    expect(placeholder).toContain("workspaces/");

    // ヒントテキストに workspaces が含まれること
    const hintText = page.locator(".tbl-modal p").first();
    await expect(hintText).toContainText("workspaces/");
  });

  test("AddWorkspaceDialog をキャンセルで閉じられる (regression なし)", async ({ page }) => {
    await setupWithNoWorkspace(page);
    await page.goto("/workspace/list");
    await expect(page).toHaveURL("/workspace/list");

    const addBtn = page.locator("button", { hasText: "追加" }).first();
    await addBtn.click();
    await expect(page.locator(".tbl-modal")).toBeVisible();

    // キャンセルボタンで閉じること
    const cancelBtn = page.locator(".tbl-modal button", { hasText: "キャンセル" }).first();
    await cancelBtn.click();
    await expect(page.locator(".tbl-modal")).not.toBeVisible();
  });

  test("AddWorkspaceDialog でパスを入力して確認できる (任意フォルダ open regression なし)", async ({ page }) => {
    await setupWithNoWorkspace(page);
    await page.goto("/workspace/list");
    await expect(page).toHaveURL("/workspace/list");

    const addBtn = page.locator("button", { hasText: "追加" }).first();
    await addBtn.click();
    await expect(page.locator(".tbl-modal")).toBeVisible();

    // 入力欄にパスを入力できること
    const input = page.locator(".tbl-modal input[type='text']").first();
    await input.fill("/tmp/test-workspace-regression");
    await expect(input).toHaveValue("/tmp/test-workspace-regression");

    // 確認ボタンが押せること (MCP 未接続なのでエラーになるが UI 動作として regression なし)
    const confirmBtn = page.locator(".tbl-modal button", { hasText: "確認" }).first();
    await confirmBtn.click();
    // エラーか inspecting か needsInit か ready のいずれかの状態になること
    await page.waitForTimeout(500);
    // ダイアログはまだ表示されていること (エラー表示のため)
    await expect(page.locator(".tbl-modal")).toBeVisible();
  });
});

test.describe("WorkspaceSelectView — 新規作成ボタン (#755)", () => {
  test("「新しくワークスペースを追加」ボタンで AddWorkspaceDialog が開く", async ({ page }) => {
    await setupWithNoWorkspace(page);
    await page.goto("/workspace/select");
    await expect(page).toHaveURL("/workspace/select");

    // 「新しくワークスペースを追加」ボタンが表示されること (lockdown でない場合)
    const addBtn = page.locator("button", { hasText: "新しくワークスペースを追加" }).first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // ダイアログが表示されること
    await expect(page.locator(".tbl-modal")).toBeVisible();

    // workspaces/ のヒントが表示されること
    const hintText = page.locator(".tbl-modal p").first();
    await expect(hintText).toContainText("workspaces/");
  });
});
