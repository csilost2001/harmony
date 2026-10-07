/**
 * 業務部品デザイナ (画面デザイン) の E2E。
 *
 * - 空の画面から作る → 部品をドラッグ配置 → 項目定義を編集 → 保存 → 原本 JSON に反映
 * - 旧デザイン (GrapesJS HTML) から自動変換 → 保存
 * - テーブル列から入力項目を作る (型・桁・必須を引き継ぐ)
 * - 画面を開いただけでは原本が変わらない
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

// 画面 JSON を直接読んで検証するため、テスト間で workspace を共有して直列に実行する
test.describe.configure({ mode: "serial" });

const KEY = `screen-layout-designer-${Date.now()}`;
let ws: OpenedWorkspace;

async function readScreen(id: string): Promise<{ items: Array<Record<string, unknown>>; layout?: { nodes: Array<Record<string, unknown>> } }> {
  return JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony", "screens", `${id}.json`), "utf-8"));
}

/** 画面デザインを開く。旧形式の画面では案内帯の「業務部品形式へ移行」で業務部品デザイナに切り替える */
async function openDesigner(page: Page, screenId: string) {
  await ws.gotoActive(page, `/screen/design/${screenId}`);
  const banner = page.getByTestId("legacy-back-to-layout");
  const designer = page.getByTestId("screen-layout-designer");
  await expect(banner.or(designer)).toBeVisible({ timeout: 15000 });
  if (await banner.isVisible()) await banner.click();
  await expect(designer).toBeVisible({ timeout: 15000 });
}

/**
 * 保存して、原本 JSON が条件を満たすまで待つ。
 * 保存後も編集セッションは継続する (タブの ● は「編集中」の印で、保存後も残る)。
 */
async function save(page: Page, screenId: string, done: (s: Awaited<ReturnType<typeof readScreen>>) => boolean) {
  await page.getByTestId("edit-mode-save").click();
  await expect.poll(async () => done(await readScreen(screenId)), { timeout: 10000 }).toBe(true);
}

test.describe("業務部品デザイナ", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("画面を開いただけでは原本が変わらない @regression", async ({ page }) => {
    const before = await fs.readFile(path.join(ws.workspacePath, "harmony", "screens", "cart.json"), "utf-8");
    await openDesigner(page, "cart");
    await expect(page.getByTestId("layout-start")).toBeVisible();
    await page.waitForTimeout(1000);
    const after = await fs.readFile(path.join(ws.workspacePath, "harmony", "screens", "cart.json"), "utf-8");
    expect(after).toBe(before);
  });

  test("空の画面から作り、部品を置いて項目を定義し保存する @regression", async ({ page }) => {
    await openDesigner(page, "order-complete");
    await page.getByTestId("layout-start-empty").click();
    await expect(page.getByTestId("layout-canvas")).toBeVisible();
    await expect(page.getByTestId("layout-node-pageTitle")).toBeVisible();

    // パレットから入力フォームをキャンバスへドラッグ
    await page.getByTestId("layout-part-form").dragTo(page.getByTestId("layout-canvas").locator(".pv-root"), { targetPosition: { x: 200, y: 120 } });
    await expect(page.getByTestId("layout-node-form")).toBeVisible();

    // フォームを選択した状態で「項目」をクリック → フォームの中に新しい項目
    await page.getByTestId("layout-node-form").click({ position: { x: 10, y: 10 } });
    await page.getByTestId("layout-part-field").click();
    await expect(page.getByTestId("layout-item-editor")).toBeVisible();
    await page.locator("#sld-item-label").fill("顧客名");
    await page.locator("#sld-item-label").blur();
    await page.locator("#sld-item-maxl").fill("40");
    await page.getByLabel("必須").check();

    await save(page, "order-complete", (s) => s.items.some((i) => i.label === "顧客名" && i.maxLength === 40));
    const s = await readScreen("order-complete");
    const form = s.layout?.nodes.find((n) => n.type === "form") as { children: Array<{ type: string; itemRef: string }> };
    expect(form.children[0]).toMatchObject({ type: "field" });
    const item = s.items.find((i) => i.id === form.children[0].itemRef);
    expect(item).toMatchObject({ label: "顧客名", maxLength: 40, required: true, type: "string" });
  });

  test("旧デザインから自動変換して保存する @regression", async ({ page }) => {
    await openDesigner(page, "cart");
    await page.getByTestId("layout-start-convert").click();
    await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("layout-node-addToCartButton")).toBeVisible();
    await expect(page.getByTestId("layout-node-addProductCode")).toBeVisible();
    await save(page, "cart", (s) => (s.layout?.nodes.length ?? 0) > 1);
    const s = await readScreen("cart");
    expect(s.layout?.nodes.length).toBeGreaterThan(1);
    expect(s.items.some((i) => i.id === "addProductCode")).toBe(true);
  });

  test("テーブル列から入力項目を作る (型・桁・必須を引き継ぐ) @regression", async ({ page }) => {
    await openDesigner(page, "store-master");
    await page.getByTestId("layout-start-empty").click();
    await expect(page.getByTestId("layout-canvas")).toBeVisible();
    await page.getByTestId("layout-palette-tab-tables").click();
    await page.locator("#sld-table-select").selectOption("store-master");
    await page.getByTestId("layout-column-name").click();
    await expect(page.getByTestId("layout-item-editor")).toBeVisible();
    await save(page, "store-master", (s) => s.items.some((i) => i.id === "name"));
    const s = await readScreen("store-master");
    const item = s.items.find((i) => i.id === "name");
    expect(item).toMatchObject({ type: "string", direction: "in", binding: { kind: "tableColumn" } });
    expect(item?.required).toBe(true);
    expect(typeof item?.maxLength).toBe("number");
  });
});
