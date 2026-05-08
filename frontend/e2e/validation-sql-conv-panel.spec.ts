/**
 * SQL 列検査 + 規約参照 を含む統合的な警告パネル検証 (#261 UI 統合 第 2 弾)
 *
 * ProcessFlowEditor が tableStore からテーブル定義を、public/conventions-catalog.json から
 * 規約カタログをロードして、aggregateValidation に渡す経路のテスト。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";


const groupId = "ag-sql-conv-test";
const tableId = "tbl-for-test";

const tableDef = {
  id: tableId,
  physicalName: "customers",
  name: "顧客",
  description: "",
  category: "",
  columns: [
    { id: "c1", physicalName: "id", name: "ID", dataType: "INTEGER", notNull: true, primaryKey: true, unique: false, autoIncrement: true },
    { id: "c2", physicalName: "email", name: "メール", dataType: "VARCHAR", length: 255, notNull: true, primaryKey: false, unique: true },
  ],
  indexes: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const group = {
  id: groupId,
  name: "SQL+conv 警告テスト",
  type: "screen",
  description: "",
  mode: "upstream",
  maturity: "draft",
  actions: [{
    id: "act-1", name: "検索", trigger: "click", maturity: "draft",
    inputs: [{ name: "q", type: "string", required: false }],
    steps: [
      // UNKNOWN_COLUMN: nonexistent_col が customers テーブルに無い
      {
        id: "step-sql",
        type: "dbAccess",
        description: "未定義列を参照",
        tableName: "customers",
        tableId: tableId,
        operation: "SELECT",
        sql: "SELECT id, nonexistent_col FROM customers WHERE id = @q",
        maturity: "draft",
      },
      // UNKNOWN_CONV_MSG: 未登録 @conv.msg.xxx
      {
        id: "step-val",
        type: "validation",
        description: "未登録 msg",
        conditions: "",
        rules: [{ field: "q", type: "custom", message: "@conv.msg.thisDoesNotExist" }],
        maturity: "draft",
      },
    ],
  }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const project = {
  version: 1,
  name: "sql-conv",
  screens: [],
  groups: [],
  edges: [],
  tables: [{ id: tableId, no: 1, physicalName: "customers", name: "顧客", columnCount: 2, updatedAt: tableDef.updatedAt }],
  processFlows: [{
    id: groupId, no: 1, name: group.name, type: group.type, actionCount: 1, updatedAt: group.updatedAt, maturity: "draft",
  }],
  updatedAt: new Date().toISOString(),
};

async function setupEditor(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
  if (await page.locator(".edit-mode-modal-backdrop").isVisible({ timeout: 1000 }).catch(() => false)) {
    await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
    await expect(page.locator(".edit-mode-modal-backdrop")).toBeHidden({ timeout: 5000 });
  }
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

// realWorkspace 移植 (#926): 実 backend 経由の dummy fixture
// ProcessFlow body は dummyGroup を v3 shape (top-level id + meta) で再利用する。
const dummyGroupBody: Record<string, unknown> = {
  id: groupId,
  $schema: "../../../schemas/v3/process-flow.v3.schema.json",
  meta: { id: groupId, name: group.name, kind: group.type ?? group.kind ?? "screen", mode: "upstream", maturity: "draft", version: "1.0.0", createdAt: group.createdAt ?? "2026-05-08T00:00:00.000Z", updatedAt: group.updatedAt ?? "2026-05-08T00:00:00.000Z" },
  actions: group.actions,
  ...((group as Record<string, unknown>).markers !== undefined ? { markers: (group as Record<string, unknown>).markers } : {}),
};

const WS_KEY = "issue-926-validation-sql-conv-panel";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.beforeAll(async () => {
  mcpAvailable = await isMcpRunning();
});

test.afterAll(async () => {
  if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
});

test.beforeEach(async () => {
  test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    processFlows: [dummyGroupBody as unknown as { id: string }],
  });
});
test.describe("SQL 列検査 + 規約参照 の UI 統合 (#261)", () => {
  test("UNKNOWN_COLUMN 警告がパネルに表示される", async ({ page }) => {
    await setupEditor(page);
    // テーブル定義と規約カタログが load されるまで待つ
    await page.waitForTimeout(500);
    const badge = page.locator(".validation-badge.warning");
    await expect(badge).toBeVisible();
    await badge.click();
    const panel = page.locator(".process-flow-validation-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("UNKNOWN_COLUMN");
    await expect(panel).toContainText("nonexistent_col");
  });

  test("UNKNOWN_CONV_MSG 警告 (規約カタログから検査)", async ({ page }) => {
    await setupEditor(page);
    await page.waitForTimeout(500);
    await page.locator(".validation-badge.warning").click();
    const panel = page.locator(".process-flow-validation-panel");
    await expect(panel).toContainText("UNKNOWN_CONV_MSG");
    await expect(panel).toContainText("thisDoesNotExist");
  });
});
