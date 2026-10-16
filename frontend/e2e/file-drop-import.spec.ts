/**
 * ファイルのドロップで取り込みを始める (UI 改善提案 第 3 弾 #46)。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `file-drop-import-${Date.now()}`;
let ws: OpenedWorkspace;

/** 画面の上へ、ファイルをドロップしたことにする (dragenter → dragover → drop) */
async function dropFile(page: Page, name: string, content: string) {
  await page.evaluate(({ name, content }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([content], name, { type: "text/plain" }));
    const target = document.querySelector("#app-main") ?? document.body;
    for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { name, content });
}

test.describe("ファイルのドロップ", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("DDL (.sql) をドロップすると、連携と運用の取り込みが開き、予行が出る (まだ何も作らない)", async ({ page }) => {
    await ws.gotoActive(page, "/screen/list");
    await expect(page.locator("#app-main")).toBeVisible();
    await dropFile(page, "schema.sql", "CREATE TABLE dropped_items (\n  id BIGINT PRIMARY KEY,\n  name VARCHAR(40) NOT NULL\n);");
    await expect(page).toHaveURL(/\/operations$/, { timeout: 10000 });
    await expect(page.getByTestId("op-import")).toBeVisible();
    await expect(page.getByTestId("op-ddl-text")).toHaveValue(/CREATE TABLE dropped_items/);
    await expect(page.getByTestId("op-ddl-row")).toHaveCount(1);
    await expect(page.getByTestId("op-ddl-row")).toContainText("dropped_items");
  });

  test("OpenAPI (.json) は、OpenAPI の欄へ。取り込めない種類のファイルは、案内だけ", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await dropFile(page, "api.json", JSON.stringify({ openapi: "3.0.3", paths: { "/orders": { get: { summary: "注文の一覧", responses: { 200: { description: "成功" } } } } } }));
    await expect(page).toHaveURL(/\/operations$/, { timeout: 10000 });
    await expect(page.getByTestId("op-openapi-text")).toHaveValue(/"openapi"/);
    await expect(page.getByTestId("op-openapi-row")).toHaveCount(1);

    await ws.gotoActive(page, "/table/list");
    await dropFile(page, "memo.txt", "x");
    await expect(page.getByText(/取り込めるファイルは/)).toBeVisible();
    await expect(page).toHaveURL(/\/table\/list$/);
  });
});
