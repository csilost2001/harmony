/**
 * 安全性・データの堅牢性 (第 1 弾) の画面での確認:
 *  - 外部で書き換えられた設計ファイルを検知して、画面に反映する / 知らせる
 *  - 保存前の版 (上書きされる前の内容) から編集を始められる
 *  - ダッシュボードの要確認パネルの内訳と、一覧の食い違いを直す操作
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";
import { esdClick } from "./helpers/editSessionDropdown";

test.describe.configure({ mode: "serial" });

const KEY = `hardening-${Date.now()}`;
let ws: OpenedWorkspace;
const tableFile = (id = "order-item") => path.join(ws.workspacePath, "harmony", "tables", `${id}.json`);
const readTable = async (id = "order-item") => JSON.parse(await fs.readFile(tableFile(id), "utf-8"));

test.describe("安全性・データの堅牢性", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("外部で書き換えられた設計ファイルは、編集していなければ自動で読み直し、全体の知らせが出る", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order-item");
    const nameLabel = page.locator(".table-name-display");
    await expect(nameLabel).toBeVisible({ timeout: 15000 });
    const before = (await readTable()).physicalName as string;
    await expect(nameLabel).toHaveText(before);

    // backend を通さず、ファイルを直接書き換える (エディタ・git・別の AI の操作に相当)
    const t = await readTable();
    t.physicalName = "externally_changed";
    await fs.writeFile(tableFile(), JSON.stringify(t, null, 2));

    await expect(nameLabel).toHaveText("externally_changed", { timeout: 10000 });
    await expect(page.getByTestId("toast").filter({ hasText: "設計ファイルが外部で更新されました" })).toBeVisible({ timeout: 10000 });
  });

  test("編集中に外部で書き換えられたら、上書きせず「別のクライアントでデータが変更されました」の帯で知らせる", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order-item");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const rows = page.locator(".columns-data-list .data-list-row");
    await rows.first().dblclick();
    await page.getByTestId("column-detail").locator("input[type=text]").nth(1).fill("編集中の表示名");
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();

    const t = await readTable();
    t.physicalName = "changed_while_editing";
    await fs.writeFile(tableFile(), JSON.stringify(t, null, 2));

    await expect(page.locator(".server-change-banner")).toBeVisible({ timeout: 10000 });
    // 編集中の内容は、そのまま残っている
    await expect(page.getByTestId("column-detail").locator("input[type=text]").nth(1)).toHaveValue("編集中の表示名");
    // 破棄して閲覧へ戻す
    await page.getByTestId("edit-mode-discard").click();
    await page.getByTestId("discard-confirm").click().catch(() => undefined);
  });

  test("保存すると上書きされる前の内容が版に残り、履歴の画面から、その内容を編集画面に読み込んで保存できる", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order-item");
    const original = (await readTable()).name as string;
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });

    // 保存を 1 回 (カラムの表示名を変える)
    await page.locator(".columns-data-list .data-list-row").first().dblclick();
    await page.getByTestId("column-detail").locator("input[type=text]").nth(1).fill("版のテスト");
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByTestId("edit-mode-save")).toBeDisabled({ timeout: 10000 });

    // 履歴 (保存前の版) を開く
    await esdClick(page, "esd-toggle-btn");
    await esdClick(page, "esd-history-btn");
    const versions = page.getByTestId("file-versions");
    await expect(versions).toBeVisible({ timeout: 10000 });
    await expect(versions).toContainText("上書きされた内容");

    // 最新の版 (= 保存する前の内容) を、編集画面に読み込む。未保存の変更になり、保存するまでファイルは変わらない
    page.once("dialog", (d) => d.accept());
    await versions.locator("button").first().click();
    const firstRow = page.locator(".columns-data-list .data-list-row").first();
    await expect(firstRow).not.toContainText("版のテスト", { timeout: 10000 });
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();
    expect(JSON.stringify(await readTable())).toContain("版のテスト");
    expect(original).toBeTruthy();

    // 保存すると、読み込んだ内容がファイルになる (保存前の「版のテスト」は、さらに新しい版として残る)
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByTestId("edit-mode-save")).toBeDisabled({ timeout: 10000 });
    expect(JSON.stringify(await readTable())).not.toContain("版のテスト");
  });

  test("draft 履歴の「復元」: 編集画面の中から復元すると、画面が開き直り、その時点の内容が編集状態に入る", async ({ page }) => {
    // 同じ設計の別の編集セッションが残っていると、保存の衝突になる。この試験は、ほかの試験と別の設計 (商品マスタ) を使う
    await ws.gotoActive(page, "/table/edit/product-master");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    const rowName = () => page.getByTestId("column-detail").locator("input[type=text]").nth(1);

    // 1 回目の保存 (表示名 = 復元元)
    await page.locator(".columns-data-list .data-list-row").first().dblclick();
    await rowName().fill("復元元");
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByTestId("edit-mode-save")).toBeDisabled({ timeout: 10000 });
    // 2 回目の保存 (表示名 = 別の変更)
    await page.locator(".columns-data-list .data-list-row").first().dblclick();
    await rowName().fill("別の変更");
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByTestId("edit-mode-save")).toBeDisabled({ timeout: 10000 });
    expect(JSON.stringify(await readTable("product-master"))).toContain("別の変更");

    // draft 履歴: 古い方の「保存」の記録から復元する
    await esdClick(page, "esd-toggle-btn");
    await esdClick(page, "esd-history-btn");
    const restoreButtons = page.locator('[data-testid^="draft-history-restore-btn-"]');
    await expect(restoreButtons.first()).toBeVisible({ timeout: 10000 });
    await expect.poll(async () => restoreButtons.count(), { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    page.once("dialog", (d) => d.accept());
    await Promise.all([
      page.waitForURL(/[?&]session=/, { timeout: 15000 }),
      restoreButtons.last().click(),
    ]);

    // 開き直した画面に、その時点の内容 (復元元) が編集状態として入る。保存するまで、ファイルは変わらない
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".columns-data-list .data-list-row").first()).toContainText("復元元", { timeout: 15000 });
    await expect(page.getByTestId("edit-mode-save")).toBeEnabled();
    expect(JSON.stringify(await readTable("product-master"))).toContain("別の変更");
  });

  test("ダッシュボードの要確認パネル: 種類ごとの内訳が出る。一覧にファイルが無い項目は「一覧の食い違いを直す」で外せる", async ({ page }) => {
    // 一覧 (harmony.json) に、ファイルの無い画面を足す
    const manifestFile = path.join(ws.workspacePath, "harmony.json");
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf-8"));
    manifest.entities.tables = [...(manifest.entities.tables ?? []), { id: "ghost-table", no: 99, name: "幽霊テーブル", physicalName: "ghost", columnCount: 0, updatedAt: "2026-01-01T00:00:00.000Z" }];
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));

    await ws.gotoActive(page, "/");
    const panel = page.getByTestId("design-issues-panel");
    await expect(panel).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("design-issues-breakdown")).toContainText("テーブル");
    await expect(page.getByTestId("design-issues-kind-画面")).toBeVisible();
    await expect(panel).toContainText("幽霊テーブル");

    page.once("dialog", (d) => { expect(d.message()).toContain("一覧から外す"); d.accept(); });
    await page.getByTestId("design-issues-repair-registry").click();
    await expect(panel).not.toContainText("幽霊テーブル", { timeout: 15000 });
    const after = JSON.parse(await fs.readFile(manifestFile, "utf-8"));
    expect((after.entities.tables as Array<{ id: string }>).some((x) => x.id === "ghost-table")).toBe(false);
  });
});
