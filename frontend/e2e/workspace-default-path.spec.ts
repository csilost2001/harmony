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

test.describe("AddWorkspaceDialog — デフォルトパスのヒント (#755)", { tag: ["@regression"] }, () => {
  // #1474 で「Harmony 本体 repo の外の project を開く」方針に変更。例示は repo 外の絶対パス
  test("WorkspaceListView の「追加」ボタンでダイアログが開き repo 外の project パス例が表示される", async ({ page }) => {
    await setupWithNoWorkspace(page);
    await page.goto("/workspace/list");
    await expect(page).toHaveURL("/workspace/list");

    // 追加ボタンをクリック
    const addBtn = page.locator("button", { hasText: "追加" }).first();
    await addBtn.click();

    // ダイアログが表示されること
    await expect(page.locator(".tbl-modal")).toBeVisible();

    // フォルダパス入力欄のプレースホルダは repo 外の project 例 (…/projects/my-app/harmony-design)
    const input = page.locator(".tbl-modal input[type='text']").first();
    await expect(input).toBeVisible();
    const placeholder = await input.getAttribute("placeholder");
    expect(placeholder).toContain("projects/my-app/harmony-design");
    expect(placeholder).not.toContain("workspaces/my-app");

    // ヒントテキストで repo 外の project を推奨していること
    const hintText = page.locator(".tbl-modal p").first();
    await expect(hintText).toContainText("Harmony 本体 repo の外");
  });

  test("AddWorkspaceDialog をキャンセルで閉じられる (regression なし)", async ({ page }) => {
    await setupWithNoWorkspace(page);
    await page.goto("/workspace/list");
    await expect(page).toHaveURL("/workspace/list");

    const addBtn = page.locator("button", { hasText: "追加" }).first();
    await addBtn.click();
    await expect(page.locator(".tbl-modal")).toBeVisible();

    // キャンセルボタンで閉じること
    // 注: input にフォーカスがあると recent path autocomplete dropdown が button を覆うため
    // タイトル要素をクリックして blur させてから cancel をクリックする
    await page.locator(".tbl-modal-title").click();
    const cancelBtn = page.locator(".tbl-modal-btns button", { hasText: "キャンセル" }).first();
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

test.describe("WorkspaceSelectView — 新規作成ボタン (#755)", { tag: ["@regression"] }, () => {
  test("「プロジェクトを開く / 作成」ボタンで AddWorkspaceDialog が開く", async ({ page }) => {
    await setupWithNoWorkspace(page);
    await page.goto("/workspace/select");
    await expect(page).toHaveURL("/workspace/select");

    // 「プロジェクトを開く / 作成」ボタンが表示されること (lockdown でない場合、#1474 で文言変更)
    const addBtn = page.getByTestId("workspace-open-or-create");
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // ダイアログが表示されること
    await expect(page.locator(".tbl-modal")).toBeVisible();

    // repo 外の project を推奨するヒントが表示されること
    const hintText = page.locator(".tbl-modal p").first();
    await expect(hintText).toContainText("Harmony 本体 repo の外");
  });
});
