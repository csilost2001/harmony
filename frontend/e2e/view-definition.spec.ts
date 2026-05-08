/**
 * ビュー定義 E2E
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   旧 spec は docs/sample-project-v3/retail/ から table を読み込んでいたが、
 *   そのファイルは migration で消えているため、本 spec ではダミーテーブルを直接定義する。
 */
import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const TABLE_ID = "eb574288-88f2-419f-ac5e-56a9948e8f46";
const CREATED_NAME = "E2E 商品ビュー";
const UPDATED_NAME = "E2E 商品ビュー 更新";

const sampleTable = {
  id: TABLE_ID,
  name: "商品",
  physicalName: "products",
  category: "マスタ",
  maturity: "draft",
  columns: [
    { id: "col-1", physicalName: "id", name: "ID", dataType: "INTEGER", primaryKey: true, notNull: true, unique: false, autoIncrement: true },
    { id: "col-2", physicalName: "name", name: "商品名", dataType: "TEXT", notNull: true, primaryKey: false, unique: false, autoIncrement: false },
  ],
  indexes: [],
  constraints: [],
};

const dummyProject = {
  version: 1, name: "view-definition-e2e",
  screens: [], groups: [], edges: [], processFlows: [],
  tables: [{ id: TABLE_ID, no: 1, name: sampleTable.name, physicalName: sampleTable.physicalName, category: sampleTable.category, columnCount: sampleTable.columns.length, maturity: "draft" }],
};

const TABLE_NORM = normalizeId(TABLE_ID);
const WS_KEY = "issue-926-view-definition";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("ビュー定義 E2E", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      tables: [sampleTable],
    });
    await page.addInitScript(() => {
      localStorage.removeItem("list-view-mode:view-definition-list");
    });
    await ws.gotoActive(page, "/view-definition/list");
    await expect(page.getByText("ビュー定義一覧").first()).toBeVisible({ timeout: 10000 });
  });

  test("一覧画面が表示される", async ({ page }) => {
    await expect(page).toHaveURL(/\/w\/[^/]+\/view-definition\/list$/);
  });

  test("新規追加 → 編集 → 保存 → 一覧反映", async ({ page }) => {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await expect(page.locator(".edit-mode-modal-backdrop")).toBeHidden({ timeout: 5000 });
    }
    // 編集モードへ
    const editStart = page.getByTestId("edit-mode-start");
    if (await editStart.isVisible({ timeout: 1000 }).catch(() => false)) {
      await editStart.click();
    }

    await page.getByRole("button", { name: /ビュー定義追加/ }).click();
    await expect(page.getByText("ビュー定義追加").first()).toBeVisible();
    // モーダル内のフィールドは label 内に <span> が入る複合構造のため、placeholder + select で指定
    await page.locator('.tbl-modal input[placeholder="顧客一覧"]').fill(CREATED_NAME);
    await page.locator('.tbl-modal select').nth(0).selectOption("list");
    await page.locator('.tbl-modal select').nth(1).selectOption(TABLE_NORM);
    await page.getByRole("button", { name: "作成して編集" }).click();

    await expect(page).toHaveURL(/\/w\/[^/]+\/view-definition\/edit\//);
    await expect(page.getByText("ビュー定義編集").first()).toBeVisible();

    await page.getByLabel(/表示名/).fill(UPDATED_NAME);
    await expect(page.getByRole("button", { name: /保存/ })).toBeEnabled();
    await page.getByRole("button", { name: /保存/ }).click();
    await expect(page.getByRole("button", { name: /保存/ })).toBeDisabled();

    await page.getByTestId("editor-header-back").click();
    await expect(page).toHaveURL(/\/w\/[^/]+\/view-definition\/list$/);
    await expect(page.getByText(UPDATED_NAME).first()).toBeVisible();
  });
});
