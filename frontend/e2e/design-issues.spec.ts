/**
 * ダッシュボードの「設計の要確認」パネルの E2E。
 *
 * - 問題のないサンプル (retail) では「エラー・警告はありません」
 * - 帳票を壊す / 出どころのない項目を足すと、エラー・警告の件数と内容が出て、設計書へ移動できる
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `design-issues-${Date.now()}`;
let ws: OpenedWorkspace;
const reportFile = (id: string) => path.join(ws.workspacePath, "harmony", "reports", `${id}.json`);

test.describe("設計の要確認パネル", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("問題がなければ「エラー・警告はありません」 / 壊れた帳票と出どころのない項目は件数と内容に出て、設計書へ移動できる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    const panel = page.getByTestId("design-issues-panel");
    await expect(panel).toContainText("エラー・警告はありません", { timeout: 15000 });

    await fs.writeFile(reportFile("broken"), "{ not json");
    const rp = JSON.parse(await fs.readFile(reportFile("delivery-note"), "utf-8"));
    rp.sections.find((s: { kind: string }) => s.kind === "detail").fields.push({ id: "noSrc", label: "出どころなし", kind: "field" });
    await fs.writeFile(reportFile("delivery-note"), JSON.stringify(rp));

    await page.reload();
    await expect(page.getByTestId("design-issues-error")).toContainText("エラー 1", { timeout: 15000 });
    await expect(page.getByTestId("design-issues-warning")).toContainText("警告 1");
    await expect(page.getByTestId("design-issues-panel")).toContainText("broken.json");
    await expect(page.getByTestId("design-issues-panel")).toContainText("出どころ");

    await page.getByTestId("design-issues-open").click();
    await expect(page.getByTestId("design-document-view")).toBeVisible({ timeout: 15000 });
  });
});
