/**
 * 帳票の E2E。
 *
 * - サンプル (retail) の帳票を開いても原本が変わらず、用紙の見本に部・項目が出る
 * - 一覧から新規作成 → 部・項目を足して出どころ (テーブルの列) を選び、保存 → 原本 JSON に反映
 * - 元に戻す / 破棄 / 設計書に章が出る
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { openBrowserSessionWorkspace, closeBrowserSession, sendBrowserRequest } from "./mcp/_helpers";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `report-${Date.now()}`;
let ws: OpenedWorkspace;
const file = (id: string) => path.join(ws.workspacePath, "harmony", "reports", `${id}.json`);
const read = async (id: string) => JSON.parse(await fs.readFile(file(id), "utf-8"));

async function openEditor(page: Page, id: string) {
  await ws.gotoActive(page, `/report/edit/${id}`);
  await expect(page.getByTestId("report-editor")).toBeVisible({ timeout: 15000 });
}

test.describe("帳票", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await closeBrowserSession(); await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("サンプルの帳票を開いても原本が変わらず、用紙の見本に部と項目が出る @regression", async ({ page }) => {
    const before = await fs.readFile(file("delivery-note"), "utf-8");
    await openEditor(page, "delivery-note");
    await expect(page.getByTestId("rp-section-lines")).toBeVisible();
    await expect(page.getByTestId("rp-field-productName").first()).toBeVisible();
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    await page.getByTestId("rp-field-productName").first().click();
    await expect(page.getByTestId("rp-field-inspector")).toBeVisible();
    await expect(page.getByTestId("rp-field-label")).toHaveValue("商品名");
    expect(await fs.readFile(file("delivery-note"), "utf-8")).toBe(before);
  });

  test("一覧から新規作成し、項目を足して出どころを選び、保存できる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/report/list");
    await expect(page.getByTestId("report-list")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("納品書").first()).toBeVisible();
    await page.getByTestId("rp-add").click();
    await page.getByTestId("rp-add-name").fill("商品一覧表");
    await page.locator("#rp-add-id").fill("product-list");
    await page.getByTestId("rp-add-submit").click();
    await expect(page.getByTestId("report-editor")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("rp-name")).toHaveValue("商品一覧表");

    // 明細部に項目を足し、商品マスタの列を出どころにする
    await page.getByTestId("rp-list-section-lines").click();
    await page.getByTestId("rp-add-field").click();
    await page.getByTestId("rp-field-label").fill("商品名");
    await page.getByTestId("rp-field-source").selectOption("product-master.name");
    await page.getByTestId("rp-field-width").fill("60");
    await page.getByTestId("rp-list-section-lines").click();
    await page.getByTestId("rp-add-field").click();
    await page.getByTestId("rp-field-label").fill("単価");
    await page.getByTestId("rp-field-source").selectOption("product-master.unit_price");
    await page.getByTestId("rp-field-format").fill("¥#,##0");
    await page.getByTestId("rp-field-align").selectOption("right");
    await expect(page.getByTestId("rp-dirty")).toBeVisible();
    await page.getByTestId("rp-save").click();
    await expect.poll(async () => (await read("product-list")).sections.find((s: { id: string }) => s.id === "lines").fields.length, { timeout: 10000 }).toBe(2);
    const r = await read("product-list");
    expect(r.$schema).toContain("report.v3.schema.json");
    const [a, b] = r.sections.find((s: { id: string }) => s.id === "lines").fields;
    expect(a).toMatchObject({ kind: "field", label: "商品名", source: "product-master.name", width: 60 });
    expect(b).toMatchObject({ label: "単価", source: "product-master.unit_price", format: "¥#,##0", align: "right" });
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
  });

  test("部を足して集計を設定でき、出力形式・用紙を変えられる @regression", async ({ page }) => {
    await openEditor(page, "product-list");
    await page.getByTestId("rp-add-section").selectOption("reportFooter");
    await page.getByTestId("rp-add-field").click();
    await expect(page.getByTestId("rp-field-kind")).toHaveValue("aggregate");
    await page.getByTestId("rp-field-label").fill("単価合計");
    await page.getByTestId("rp-field-source").selectOption("product-master.unit_price");
    await page.getByTestId("rp-field-aggregate").selectOption("sum");
    await page.getByTestId("rp-orientation").selectOption("landscape");
    await page.getByTestId("rp-paper").selectOption("A3");
    await page.getByTestId("rp-save").click();
    await expect.poll(async () => (await read("product-list")).output?.paper, { timeout: 10000 }).toBe("A3");
    const r = await read("product-list");
    expect(r.output).toMatchObject({ paper: "A3", orientation: "landscape" });
    const footer = r.sections.find((s: { kind: string }) => s.kind === "reportFooter");
    expect(footer.fields[0]).toMatchObject({ kind: "aggregate", aggregate: "sum", source: "product-master.unit_price" });
    // 用紙の見本は A3 横の比率になる
    await expect(page.getByTestId("rp-paper-view").locator(".rp-paper")).toHaveAttribute("data-paper", "A3");
  });

  test("変更は元に戻せ、破棄で保存済みの状態に戻る。要確認が出る @regression", async ({ page }) => {
    await openEditor(page, "product-list");
    const n = (await read("product-list")).sections.length;
    await page.getByTestId("rp-add-section").selectOption("pageFooter");
    await expect(page.getByTestId("rp-dirty")).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    await page.getByTestId("rp-add-section").selectOption("groupHeader"); // groupBy が無いので要確認
    await expect(page.getByTestId("rp-issue").first()).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("rp-discard").click();
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    expect((await read("product-list")).sections.length).toBe(n);
  });

  test("他 (AI・別タブ) が保存したら、未編集なら読み直し、編集中なら知らせて保存の競合を防ぐ @regression", async ({ page }) => {
    await openBrowserSessionWorkspace(ws.workspacePath);
    const external = async (name: string) => {
      const r = await read("product-list");
      await sendBrowserRequest("saveReport", { reportId: "product-list", data: { ...r, name } });
    };
    await openEditor(page, "product-list");
    await external("外部で変更 1");
    await expect(page.getByTestId("rp-name")).toHaveValue("外部で変更 1");
    await expect(page.getByTestId("rp-outdated")).toHaveCount(0);
    await page.getByTestId("rp-add-section").selectOption("pageFooter");
    await expect(page.getByTestId("rp-dirty")).toBeVisible();
    await external("外部で変更 2");
    await expect(page.getByTestId("rp-outdated")).toBeVisible();
    await page.getByTestId("rp-save").click();
    await expect(page.getByTestId("rp-outdated")).toContainText("保存しませんでした");
    expect((await read("product-list")).name).toBe("外部で変更 2");
    await page.getByTestId("rp-force-save").click();
    await expect.poll(async () => (await read("product-list")).name, { timeout: 10000 }).toBe("外部で変更 1");
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
  });

  test("画面・テーブルの ID 改名で出力契機・項目の出どころが追従し、開いている編集画面にも反映される @regression", async ({ page }) => {
    await openBrowserSessionWorkspace(ws.workspacePath);
    await openEditor(page, "delivery-note");
    await expect(page.getByTestId("rp-trigger-screen")).toHaveValue("order-complete");
    await sendBrowserRequest("renameEntityId", { entityType: "screen", oldId: "order-complete", newId: "order-complete-x" });
    await expect.poll(async () => (await read("delivery-note")).trigger.screenRef).toBe("order-complete-x");
    // 未編集なので読み直され、選択肢も新しい ID を指す
    await expect(page.getByTestId("rp-trigger-screen")).toHaveValue("order-complete-x", { timeout: 10000 });
    await sendBrowserRequest("renameEntityId", { entityType: "table", oldId: "order-item", newId: "order-item-x" });
    await expect.poll(async () => JSON.stringify(await read("delivery-note"))).toContain('"order-item-x.');
    expect(JSON.stringify(await read("delivery-note"))).not.toContain('"order-item.');
    await expect(page.getByTestId("rp-outdated")).toHaveCount(0);
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
  });

  test("部の一覧は持ち手で、用紙の見本の項目は同じ部の中でドラッグして並べ替えられる @regression", async ({ page }) => {
    await openEditor(page, "delivery-note");
    const before = await read("delivery-note");
    const secIds: string[] = before.sections.map((s: { id: string }) => s.id);
    const grip = (id: string) => page.getByTestId(`sortable-grip-${id}`);
    // 画面の端に近いと、ドラッグ中に一覧が自動でスクロールしてしまうため、一覧を中央に出してからつかむ
    await page.getByTestId("rp-section-list").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const a = await grip(secIds[0]).boundingBox(), b = await grip(secIds[2]).boundingBox();
    if (!a || !b) throw new Error("持ち手が見つかりません");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 6, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 4, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150); // ドロップ直後の 1 回のクリックは、つかんだ操作の一部として無視される
    await expect(page.getByTestId("rp-dirty")).toBeVisible();
    await page.getByTestId("rp-save").click();
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    expect((await read("delivery-note")).sections.map((s: { id: string }) => s.id)).toEqual([secIds[1], secIds[2], secIds[0], ...secIds.slice(3)]);

    // 用紙の見本: 明細の「商品名」を「金額」の右へ動かす
    const detail = (await read("delivery-note")).sections.find((s: { kind: string }) => s.kind === "detail");
    const ids: string[] = detail.fields.map((f: { id: string }) => f.id);
    await page.getByTestId(`rp-field-${ids[0]}`).first().dragTo(page.getByTestId(`rp-field-${ids[ids.length - 1]}`).first(), { targetPosition: { x: 4, y: 4 } });
    await expect(page.getByTestId("rp-dirty")).toBeVisible();
    await page.getByTestId("rp-save").click();
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    const after = (await read("delivery-note")).sections.find((s: { kind: string }) => s.kind === "detail").fields.map((f: { id: string }) => f.id);
    expect(after).not.toEqual(ids);
    expect([...after].sort()).toEqual([...ids].sort());
    expect(after.indexOf(ids[0])).toBe(ids.length - 1);
  });

  test("設計書に「帳票」の章 (用紙の見本と項目定義) が出る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/document");
    await expect(page.locator("#reports")).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".hd-rp .rp-paper").first()).toBeVisible();
  });
});
