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
import { buildProject, buildProcessFlow, buildTable } from "./__fixtures__/builders";
import type { Column, LocalId, PhysicalName, ProjectEntities, Timestamp } from "../src/types/v3";

const TABLE_ID = `tbl-e2e-dirty-mark-${Date.now()}`;
const PF_ID = `pf-e2e-dirty-mark-${Date.now()}`;
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyTable = buildTable({
  id: TABLE_ID,
  physicalName: "dirty_mark_test",
  name: "dirty マークテスト",
  category: "マスタ",
  columns: [{ id: "col-001" as unknown as LocalId, physicalName: "id" as unknown as PhysicalName, name: "ID", dataType: "INTEGER", notNull: true, primaryKey: true, unique: false, autoIncrement: true }] as Column[],
});

const dummyProcessFlowBody = buildProcessFlow({
  id: PF_ID,
  name: "dirty マークテストフロー",
  kind: "screen",
  mode: "upstream",
  actions: [{ id: "act-001", name: "テストアクション", trigger: "click", maturity: "draft", steps: [] }] as ReturnType<typeof buildProcessFlow>["actions"],
});

const dummyProject = buildProject({
  name: "dirty-mark-test",
  entities: {
    tables: [{ id: TABLE_ID, no: 1, name: dummyTable.name, physicalName: dummyTable.physicalName, category: dummyTable.category, columnCount: 1, maturity: "draft", updatedAt: FIXED_TS }],
    processFlows: [{ id: PF_ID, no: 1, name: "dirty マークテストフロー", kind: "screen", actionCount: 1, maturity: "draft", updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

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

  test("シナリオ 1: 編集開始 → 編集 → タブ閉じる → 一覧で ● 表示", async ({ page }) => {
    await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
    const editBtn = page.getByTestId("edit-mode-start");
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    // 編集して draft (editSession.update payload) が backend に書かれるよう変更を加える
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await page.waitForTimeout(500); // editSession.update debounce
    // 保存せずに一覧へ戻る (SPA navigation で active workspace 維持)
    await ws.gotoActive(page, "/table/list");
    const draftMark = page.locator(".list-item-draft-mark").first();
    await expect(draftMark).toBeVisible({ timeout: 8000 });
    await expect(draftMark).toHaveAttribute("title", "未保存の編集中 draft があります");
  });

  test("シナリオ 2: 一覧 ● → 再 open → ResumeOrDiscardDialog → 「続ける」", async ({ page }) => {
    await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
    // 前テスト残骸の draft が ResumeOrDiscardDialog として出る場合があるので dismiss
    await page.waitForTimeout(1000);
    for (let _i = 0; _i < 5; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        const discardEl = page.getByTestId("resume-discard");
        if (await discardEl.isVisible().catch(() => false)) {
          await discardEl.click({ force: true });
        } else {
          await page.evaluate(() => {
            const el = document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null;
            if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
        }
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(300);
      } else { break; }
    }
    const editBtn = page.getByTestId("edit-mode-start");
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    // 編集して draft を作る
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await page.waitForTimeout(500);
    await ws.gotoActive(page, "/table/list");
    await ws.gotoActive(page, `/table/edit/${TABLE_NORM}`);
    const continueBtn = page.getByTestId("resume-continue");
    await expect(continueBtn).toBeVisible({ timeout: 8000 });
    await continueBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
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
    // 前テスト残骸の draft が ResumeOrDiscardDialog として出る場合があるので dismiss
    await page.waitForTimeout(1000);
    for (let _i = 0; _i < 5; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        const discardEl = page.getByTestId("resume-discard");
        if (await discardEl.isVisible().catch(() => false)) {
          await discardEl.click({ force: true });
        } else {
          await page.evaluate(() => {
            const el = document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null;
            if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
        }
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(300);
      } else { break; }
    }
    const editBtn = page.getByTestId("edit-mode-start");
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    // 編集して draft を作る (アクション追加)
    await page.locator(".process-flow-tab-add").click();
    await page.locator(".process-flow-modal input.form-control").first().fill("ドラフトアクション");
    await page.locator(".process-flow-modal button.btn-primary").click();
    await expect(page.locator(".process-flow-modal")).not.toBeVisible();
    await page.waitForTimeout(500);
    await ws.gotoActive(page, "/process-flow/list");
    const draftMark = page.locator(".list-item-draft-mark").first();
    await expect(draftMark).toBeVisible({ timeout: 8000 });
    await ws.gotoActive(page, `/process-flow/edit/${PF_NORM}`);
    const discardBtn = page.getByTestId("resume-discard");
    await expect(discardBtn).toBeVisible({ timeout: 8000 });
    await discardBtn.click();
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 5000 });
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
    // 前テスト残骸の draft が ResumeOrDiscardDialog として出る場合があるので dismiss
    await page.waitForTimeout(1000);
    for (let _i = 0; _i < 5; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        const discardEl = page.getByTestId("resume-discard");
        if (await discardEl.isVisible().catch(() => false)) {
          await discardEl.click({ force: true });
        } else {
          await page.evaluate(() => {
            const el = document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null;
            if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          });
        }
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(300);
      } else { break; }
    }
    const editBtn = page.getByTestId("edit-mode-start");
    await expect(editBtn).toBeVisible({ timeout: 5000 });
    await editBtn.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    // 編集して draft を作る
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await page.waitForTimeout(500);
    // SPA 遷移 (page.goto は backend 接続を切るため使わない)
    await ws.gotoActive(page, "/table/list");
    await page.waitForTimeout(500);
    for (let _i = 0; _i < 3; _i++) {
      if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
        await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else { break; }
    }
    await expect(page.locator(".list-item-draft-mark").first()).toBeVisible({ timeout: 8000 });
  });
});
