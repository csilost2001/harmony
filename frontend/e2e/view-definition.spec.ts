/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";

const TABLE_ID = "eb574288-88f2-419f-ac5e-56a9948e8f46";
const CREATED_NAME = "E2E 商品ビュー";
const UPDATED_NAME = "E2E 商品ビュー 更新";

const sampleTable = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../docs/sample-project-v3/retail/tables/eb574288-88f2-419f-ac5e-56a9948e8f46.json"),
    "utf8",
  ),
);

async function seedRetailTable(page: Page) {
  const now = new Date().toISOString();
  const tableEntry = {
    id: TABLE_ID,
    no: 1,
    name: sampleTable.name,
    physicalName: sampleTable.physicalName,
    category: sampleTable.category,
    columnCount: sampleTable.columns.length,
    updatedAt: sampleTable.updatedAt,
    maturity: sampleTable.maturity,
  };
  const project = {
    $schema: "../schemas/v3/project.v3.schema.json",
    schemaVersion: "v3",
    meta: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "view-definition-e2e",
      createdAt: now,
      updatedAt: now,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    entities: {
      screens: [],
      screenGroups: [],
      screenTransitions: [],
      tables: [tableEntry],
      processFlows: [],
      sequences: [],
      views: [],
    },
  };

  await page.addInitScript(
    ({ project, table, tableId }) => {
      localStorage.clear();
      // workspace guard をバイパス (MCP 未接続の e2e テスト用、#703 R-5)
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("v3-project", JSON.stringify(project));
      localStorage.setItem(`v3-table-${tableId}`, JSON.stringify(table));
      localStorage.removeItem("harmony-open-tabs");
      localStorage.removeItem("harmony-active-tab");
      localStorage.removeItem("list-view-mode:view-definition-list");
    },
    { project, table: sampleTable, tableId: TABLE_ID },
  );
}

async function openViewDefinitionListFromHeader(page: Page) {
  await page.goto("/");
  await page.locator(".header-menu-btn").click();
  await page.getByRole("menuitem", { name: "ビュー定義一覧" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+\/view-definition\/list$/);
  await expect(page.getByText("ビュー定義一覧").first()).toBeVisible();
}

test.describe.skip("ビュー定義 E2E", () => {
  test.beforeEach(async ({ page }) => {
    await seedRetailTable(page);
  });

  test("ヘッダーから一覧画面に遷移できる", async ({ page }) => {
    await openViewDefinitionListFromHeader(page);
  });

  test("新規追加 → 編集 → 保存 → 一覧反映", async ({ page }) => {
    await openViewDefinitionListFromHeader(page);

    await page.getByRole("button", { name: /ビュー定義追加/ }).click();
    await expect(page.getByText("ビュー定義追加").first()).toBeVisible();
    await page.getByLabel("表示名").fill(CREATED_NAME);
    await page.getByLabel("viewer 種別").selectOption("list");
    await page.getByLabel("ソーステーブル").selectOption(TABLE_ID);
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
