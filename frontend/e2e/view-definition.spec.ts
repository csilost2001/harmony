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
import { buildProject } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

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

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "view-definition-e2e",
  entities: {
    tables: [{ id: TABLE_ID, no: 1, name: sampleTable.name, physicalName: sampleTable.physicalName, category: sampleTable.category, columnCount: sampleTable.columns.length, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

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

  test.afterEach(async ({ page }) => {
    if (mcpAvailable) await ws.resetRuntimeState(page);
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

    // 「作成して編集」遷移直後の編集画面: ViewDefinitionEditor の auto-edit が
    // editSession を start した直後に editSession.list で同 resourceId の sessions > 0 を
    // 検知して ResumeOrDiscardDialog が出る race がある。
    // discard を選ぶと autoEditFiredRef が落ちて auto-edit が再発火しないため、
    // continue を選んで自分が作った session を継続する (#945)。
    if (await page.locator(".edit-mode-modal-backdrop").isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-continue"]') as HTMLButtonElement | null)?.click());
      await expect(page.locator(".edit-mode-modal-backdrop")).toBeHidden({ timeout: 5000 });
    }

    // #960: 「作成して編集」経由は auto-edit モードで開く (sessionStorage 経由で
    // ViewDefinitionEditor が自動的に actions.startEditing() を発火)。
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });

    await page.getByLabel(/表示名/).fill(UPDATED_NAME);
    // SaveResetButtons の保存ボタン (edit-mode-save と区別)
    const saveBtn = page.locator(".srb-btn-save");
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(saveBtn).toBeDisabled();

    await page.getByTestId("editor-header-back").click();
    await expect(page).toHaveURL(/\/w\/[^/]+\/view-definition\/list$/);
    await expect(page.getByText(UPDATED_NAME).first()).toBeVisible();
  });
});
