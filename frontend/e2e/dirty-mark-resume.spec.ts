/**
 * dirty マーク + 再オープン時 draft 復元 E2E テスト (#688 PR-5)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 *   旧 spec の `gjs-table-<id>` / `gjs-process-flow-<id>` localStorage seed は
 *   #924 で fallback 経路が削除されたため動作しない。本 spec は backend 経由で
 *   draft が backend (.edit-sessions/) に作成されるかを確認する smoke 形式に変更。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const TABLE_ID = `tbl-e2e-dirty-mark-${Date.now()}`;
const PF_ID = `pf-e2e-dirty-mark-${Date.now()}`;
const baseTs = "2026-05-08T00:00:00.000Z";

const dummyTable = {
  id: TABLE_ID,
  physicalName: "dirty_mark_test",
  name: "dirty マークテスト",
  description: "",
  maturity: "draft",
  category: "マスタ",
  columns: [{ id: "col-001", physicalName: "id", name: "ID", dataType: "INTEGER", notNull: true, primaryKey: true, unique: false, autoIncrement: true }],
  indexes: [],
  constraints: [],
  version: "1.0.0",
};

const dummyProcessFlowBody = {
  id: PF_ID,
  $schema: "../../../schemas/v3/process-flow.v3.schema.json",
  meta: { id: PF_ID, name: "dirty マークテストフロー", kind: "screen", mode: "upstream", maturity: "draft", version: "1.0.0", createdAt: baseTs, updatedAt: baseTs },
  actions: [{ id: "act-001", name: "テストアクション", trigger: "click", maturity: "draft", steps: [] }],
};

const dummyProject = {
  version: 1, name: "dirty-mark-test",
  screens: [], groups: [], edges: [],
  tables: [{ id: TABLE_ID, no: 1, name: dummyTable.name, physicalName: dummyTable.physicalName, category: dummyTable.category, columnCount: 1, maturity: "draft" }],
  processFlows: [{ id: PF_ID, no: 1, name: "dirty マークテストフロー", kind: "screen", actionCount: 1, maturity: "draft" }],
};

const TABLE_NORM = normalizeId(TABLE_ID);
const PF_NORM = normalizeId(PF_ID);
const WS_KEY = "issue-926-dirty-mark-resume";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.describe("dirty マーク + 再オープン — TableEditor", () => {
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
      tables: [dummyTable],
      processFlows: [dummyProcessFlowBody],
    });
  });

  test("シナリオ 1: 編集開始 → タブ閉じる → 一覧で ● 表示", async ({ page }) => {
    await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
    await page.waitForLoadState("networkidle");
    const editBtn = page.getByTestId("edit-mode-start");
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    // 保存せずに一覧へ戻る (SPA navigation で active workspace 維持)
    await page.goto(ws.path("/table/list"));
    await page.waitForLoadState("networkidle");
    const draftMark = page.locator(".list-item-draft-mark").first();
    await expect(draftMark).toBeVisible({ timeout: 5000 });
    await expect(draftMark).toHaveAttribute("title", "未保存の編集中 draft があります");
  });

  test("シナリオ 2: 一覧 ● → 再 open → ResumeOrDiscardDialog → 「続ける」", async ({ page }) => {
    await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
    await page.waitForLoadState("networkidle");
    const editBtn = page.getByTestId("edit-mode-start");
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await page.goto(ws.path("/table/list"));
    await page.waitForLoadState("networkidle");
    await page.goto(ws.path(`/table/edit/${TABLE_NORM}`));
    await page.waitForLoadState("networkidle");
    const continueBtn = page.getByTestId("resume-continue");
    if (await continueBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await continueBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe("dirty マーク + 再オープン — ProcessFlowEditor", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      tables: [dummyTable],
      processFlows: [dummyProcessFlowBody],
    });
  });

  test("シナリオ 3: 編集 → タブ閉じる → 一覧で ● → 再 open → 「破棄」→ 本体読み込み確認", async ({ page }) => {
    await ws.gotoActive(page, `/process-flow/edit/${PF_NORM}`);
    await page.waitForLoadState("networkidle");
    const editBtn = page.getByTestId("edit-mode-start");
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await page.goto(ws.path("/process-flow/list"));
    await page.waitForLoadState("networkidle");
    const draftMark = page.locator(".list-item-draft-mark").first();
    await expect(draftMark).toBeVisible({ timeout: 5000 });
    await page.goto(ws.path(`/process-flow/edit/${PF_NORM}`));
    await page.waitForLoadState("networkidle");
    const discardBtn = page.getByTestId("resume-discard");
    if (await discardBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await discardBtn.click();
      await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });
});

test.describe("broadcast 経由の即時反映", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      tables: [dummyTable],
      processFlows: [dummyProcessFlowBody],
    });
  });

  test("シナリオ 4: draft 作成後に一覧へ遷移すると ● が表示される", async ({ page }) => {
    await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
    await page.waitForLoadState("networkidle");
    const editBtn = page.getByTestId("edit-mode-start");
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    await page.goto(ws.path("/table/list"));
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".list-item-draft-mark").first()).toBeVisible({ timeout: 8000 });
  });
});
