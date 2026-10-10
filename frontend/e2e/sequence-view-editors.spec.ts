/**
 * シーケンス編集・ビュー編集の E2E。
 *
 * - 幅の広い画面 (FHD) では、DDL プレビューが右カラムに常時出る。狭い画面では、折りたたんでおき、押すと開く
 * - 開いただけでは原本が変わらず、編集開始 → 変更 → 保存で原本に反映される
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";
import { discardAllEditSessions } from "./helpers/editSessions";

test.describe.configure({ mode: "serial" });

const KEY = `seq-view-${Date.now()}`;
let ws: OpenedWorkspace;
const dataFile = (...p: string[]) => path.join(ws.workspacePath, "harmony", ...p);

test.describe("シーケンス・ビューの編集画面", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await discardAllEditSessions(ws.workspacePath); await ws?.resetRuntimeState(); });

  test("ビュー編集: 幅の広い画面では DDL が右に常時出て、狭い画面では押すと開く @regression", async ({ page }) => {
    const before = await fs.readFile(dataFile("views", "cart-summary-view.json"), "utf-8");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await ws.gotoActive(page, "/view/edit/cart-summary-view");
    const ddl = page.locator(".seq-ddl-preview");
    await expect(ddl).toBeVisible({ timeout: 15000 });
    await expect(ddl).toContainText("CREATE");
    await expect(page.locator(".view-editor-select-stmt")).toBeVisible();
    // 開いただけでは原本は変わらない
    expect(await fs.readFile(dataFile("views", "cart-summary-view.json"), "utf-8")).toBe(before);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(ddl).toBeHidden();
    await page.locator(".seq-ddl-toggle").click();
    await expect(ddl).toBeVisible();
  });

  test("シーケンス編集: 編集開始 → 表示名を変えて保存すると原本に反映され、DDL に出る @regression", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await ws.gotoActive(page, "/sequence/edit/customer-id-sequence");
    await expect(page.locator(".seq-ddl-preview")).toContainText("CREATE SEQUENCE", { timeout: 15000 });
    await expect(page.getByTestId("edit-mode-state")).toContainText("閲覧中");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-state")).toContainText("編集中");
    const name = page.locator(".seq-editor-body input").nth(1);
    await name.fill("顧客ID採番 (変更)");
    await page.getByTestId("edit-mode-save").click();
    await expect.poll(async () => JSON.parse(await fs.readFile(dataFile("sequences", "customer-id-sequence.json"), "utf-8")).name, { timeout: 10000 }).toBe("顧客ID採番 (変更)");
  });
});
