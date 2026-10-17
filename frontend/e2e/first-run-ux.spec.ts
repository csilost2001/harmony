/**
 * 初めての人が迷いやすいところの改善 (ISSUE #1528) の E2E。
 *
 * - 一覧の開き方の案内 (ダブルクリック / Enter)。開く (または消す) と、以後出ない
 * - 同じ画面の「デザイン」と「項目定義」を、保存しながら行き来しても、「前回の編集の続き」「上書き確認」が出ない
 * - 保存済みのときは、帯の「破棄」が「編集を終える」になる
 * - 一覧から新しく作った処理フローは、「ラフ」の深さで始まる
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `first-run-ux-${Date.now()}`;
let ws: OpenedWorkspace;
const SAVE = (page: Page) => page.locator('[data-testid="edit-mode-save"]:visible');
const START = (page: Page) => page.locator('[data-testid="edit-mode-start"]:visible');
const DISCARD = (page: Page) => page.locator('[data-testid="edit-mode-discard"]:visible');

test.describe("初めての人が迷いやすいところ (#1528)", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => {
    await cleanupRealWorkspaces([KEY]);
  });

  test("一覧の開き方の案内が出て、一度ダブルクリックで開くと、以後出ない", async ({ page }) => {
    await ws.gotoActive(page, "/screen/list");
    const hint = page.getByTestId("data-list-open-hint");
    await expect(hint).toBeVisible({ timeout: 15000 });
    await expect(hint).toContainText("ダブルクリック");
    // 1 回のクリックは、選ぶだけ (開かない)
    const target = page.locator(".data-list-row, .data-list-card").first();
    await target.click();
    await expect(page).toHaveURL(/\/screen\/list/);
    // ダブルクリックで開くと、案内は消える
    await target.dblclick();
    await expect(page).toHaveURL(/\/screen\/design\//, { timeout: 10000 });
    await ws.gotoActive(page, "/screen/list");
    await expect(page.locator(".data-list-row, .data-list-card").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("data-list-open-hint")).toHaveCount(0);
  });

  test("同じ画面のデザインと項目定義を、保存しながら行き来しても、続きの確認・上書き確認が出ない。保存後の「破棄」は「編集を終える」", async ({ page }) => {
    const screenId = "shipment-dispatch";
    const screen = JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony", "screens", `${screenId}.json`), "utf-8")) as { name: string };
    const noPrompt = async (label: string) => {
      await page.waitForTimeout(1200);
      await expect(page.getByTestId("resume-or-discard-dialog"), `${label}: 続きの確認`).toHaveCount(0);
      await expect(page.getByText("上書き確認"), `${label}: 上書き確認`).toHaveCount(0);
    };

    // デザイン: 区切り線を 1 つ足して保存
    await ws.gotoActive(page, `/screen/design/${screenId}`);
    await expect(page.getByTestId("screen-layout-designer")).toBeVisible({ timeout: 15000 });
    await START(page).click();
    await expect(SAVE(page)).toBeVisible({ timeout: 10000 });
    await page.getByTestId("layout-part-divider").click();
    await SAVE(page).click();
    await expect(page.getByTestId("edit-mode-save-status").first()).toContainText("原本と同じ", { timeout: 10000 });
    // 保存済み (変更が無い) ので、「破棄」ではなく「編集を終える」
    await expect(DISCARD(page)).toContainText("編集を終える");
    await noPrompt("デザインで保存したあと");

    // 項目定義へ (保存したまま、編集中のまま移る): 続きの確認が出ない。項目を足して保存しても、上書き確認が出ない
    await page.getByRole("button", { name: /項目一覧/ }).click();
    await expect(page).toHaveURL(new RegExp(`/screen/items/${screenId}`));
    await noPrompt("項目定義を開いたとき");
    await START(page).click();
    await expect(SAVE(page)).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "項目追加" }).click();
    await SAVE(page).click();
    await expect(page.getByTestId("edit-mode-save-status").first()).toContainText("原本と同じ", { timeout: 10000 });
    await noPrompt("項目定義で保存したあと");

    // デザインへ戻って、もう一度変更して保存しても、上書き確認が出ない (項目定義の保存を取り込んだ扱い)
    await page.locator(".tabbar-tab-label", { hasText: screen.name }).filter({ hasNotText: "項目定義" }).first().click();
    await expect(page.getByTestId("screen-layout-designer")).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1200);
    await page.getByTestId("layout-part-divider").click();
    await SAVE(page).click();
    await expect(page.getByTestId("edit-mode-save-status").first()).toContainText("原本と同じ", { timeout: 10000 });
    await noPrompt("デザインへ戻って 2 回目の保存");

    // 原本には、区切り線 2 つ分と、足した項目が入っている
    const saved = JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony", "screens", `${screenId}.json`), "utf-8")) as { items: unknown[]; layout?: { nodes: unknown[] } };
    expect(JSON.stringify(saved.layout)).toContain("divider");
    expect(saved.items.length).toBeGreaterThan(0);
  });

  test("一覧から新しく作った処理フローは、「ラフ」の深さで始まる", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/list");
    await page.getByRole("button", { name: "処理フローを追加" }).first().click();
    await page.getByPlaceholder("例: ログイン画面、月次集計バッチ").fill("深さの試験");
    await page.getByPlaceholder("例: today-sales").fill("depth-check");
    await page.getByRole("button", { name: /^作成$/ }).click();
    await expect(page).toHaveURL(/\/process-flow\/edit\/depth-check/, { timeout: 15000 });
    const rough = page.getByRole("button", { name: /ラフ/ }).first();
    await expect(rough).toHaveAttribute("aria-pressed", "true", { timeout: 10000 });
    // すでにあるフロー (サンプル) は、これまでどおり「実装」から
    await ws.gotoActive(page, "/process-flow/list");
    const firstRow = page.locator(".data-list-row, .data-list-card").first();
    await firstRow.dblclick();
    await expect(page).toHaveURL(/\/process-flow\/edit\//, { timeout: 15000 });
    await expect(page.getByRole("button", { name: /実装/ }).first()).toHaveAttribute("aria-pressed", "true", { timeout: 10000 });
  });
});
