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
import { discardAllEditSessions } from "./helpers/editSessions";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `report-${Date.now()}`;
let ws: OpenedWorkspace;
const file = (id: string) => path.join(ws.workspacePath, "harmony", "reports", `${id}.json`);
const read = async (id: string) => JSON.parse(await fs.readFile(file(id), "utf-8"));

/** 編集画面を開く。edit = true なら「編集開始」まで行う (編集は編集セッションの中でだけできる) */
async function openEditor(page: Page, id: string, edit = false) {
  await ws.gotoActive(page, `/report/edit/${id}`);
  await expect(page.getByTestId("report-editor")).toBeVisible({ timeout: 15000 });
  if (edit) await startEditing(page);
}
async function startEditing(page: Page) {
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-state")).toContainText("編集中", { timeout: 10000 });
}
const saveEdit = async (page: Page) => { await page.getByTestId("edit-mode-save").click(); };

test.describe("帳票", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await closeBrowserSession(); await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await discardAllEditSessions(ws.workspacePath); await ws?.resetRuntimeState(); });

  test("サンプルの帳票を開いても原本が変わらず、用紙の見本に部と項目が出る @regression", async ({ page }) => {
    const before = await fs.readFile(file("delivery-note"), "utf-8");
    await openEditor(page, "delivery-note");
    await expect(page.getByTestId("rp-section-lines")).toBeVisible();
    await expect(page.getByTestId("rp-field-productName").first()).toBeVisible();
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    // 開いた直後は閲覧のみ (編集開始するまで変更できない)
    await expect(page.getByTestId("edit-mode-state")).toContainText("閲覧中");
    await expect(page.getByTestId("rp-name")).toBeDisabled();
    await page.getByTestId("rp-field-productName").first().click();
    await expect(page.getByTestId("rp-field-inspector")).toBeVisible();
    await expect(page.getByTestId("rp-field-label")).toHaveValue("商品名");
    await expect(page.getByTestId("rp-field-label")).toBeDisabled();
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
    // 作成した直後は、自動で編集が始まる
    await expect(page.getByTestId("edit-mode-state")).toContainText("編集中", { timeout: 10000 });

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
    await saveEdit(page);
    await expect.poll(async () => (await read("product-list")).sections.find((s: { id: string }) => s.id === "lines").fields.length, { timeout: 10000 }).toBe(2);
    const r = await read("product-list");
    expect(r.$schema).toContain("report.v3.schema.json");
    const [a, b] = r.sections.find((s: { id: string }) => s.id === "lines").fields;
    expect(a).toMatchObject({ kind: "field", label: "商品名", source: "product-master.name", width: 60 });
    expect(b).toMatchObject({ label: "単価", source: "product-master.unit_price", format: "¥#,##0", align: "right" });
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
  });

  test("部を足して集計を設定でき、出力形式・用紙を変えられる @regression", async ({ page }) => {
    await openEditor(page, "product-list", true);
    await page.getByTestId("rp-add-section").selectOption("reportFooter");
    await page.getByTestId("rp-add-field").click();
    await expect(page.getByTestId("rp-field-kind")).toHaveValue("aggregate");
    await page.getByTestId("rp-field-label").fill("単価合計");
    await page.getByTestId("rp-field-source").selectOption("product-master.unit_price");
    await page.getByTestId("rp-field-aggregate").selectOption("sum");
    await page.getByTestId("rp-orientation").selectOption("landscape");
    await page.getByTestId("rp-paper").selectOption("A3");
    await saveEdit(page);
    await expect.poll(async () => (await read("product-list")).output?.paper, { timeout: 10000 }).toBe("A3");
    const r = await read("product-list");
    expect(r.output).toMatchObject({ paper: "A3", orientation: "landscape" });
    const footer = r.sections.find((s: { kind: string }) => s.kind === "reportFooter");
    expect(footer.fields[0]).toMatchObject({ kind: "aggregate", aggregate: "sum", source: "product-master.unit_price" });
    // 用紙の見本は A3 横の比率になる
    await expect(page.getByTestId("rp-paper-view").locator(".rp-paper")).toHaveAttribute("data-paper", "A3");
  });

  test("変更は元に戻せ、破棄で保存済みの状態に戻る。要確認が出る @regression", async ({ page }) => {
    await openEditor(page, "product-list", true);
    const n = (await read("product-list")).sections.length;
    await page.getByTestId("rp-add-section").selectOption("pageFooter");
    await expect(page.getByTestId("rp-dirty")).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.locator('[data-testid^="rp-list-section-"]')).toHaveCount(n);
    await page.getByTestId("rp-add-section").selectOption("groupHeader"); // groupBy が無いので要確認
    await expect(page.getByTestId("rp-issue").first()).toBeVisible();
    await page.getByTestId("edit-mode-discard").click();
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-state")).toContainText("閲覧中");
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    expect((await read("product-list")).sections.length).toBe(n);
  });

  test("他 (AI・別タブ) が保存したら、閲覧中は読み直し、編集中は知らせるだけで自分の変更は消さない @regression", async ({ page }) => {
    await openBrowserSessionWorkspace(ws.workspacePath);
    const external = async (name: string) => {
      const r = await read("product-list");
      await sendBrowserRequest("saveReport", { reportId: "product-list", data: { ...r, name } });
    };
    await openEditor(page, "product-list");
    await external("外部で変更 1");
    await expect(page.getByTestId("rp-name")).toHaveValue("外部で変更 1");
    await expect(page.locator(".server-change-banner")).toHaveCount(0);
    await startEditing(page);
    await page.getByTestId("rp-add-section").selectOption("pageFooter");
    await expect(page.getByTestId("rp-dirty")).toBeVisible();
    await external("外部で変更 2");
    await expect(page.locator(".server-change-banner")).toBeVisible();
    await expect(page.getByTestId("rp-name")).toHaveValue("外部で変更 1");
    await page.locator(".scb-btn-reload").click();
    await expect(page.getByTestId("rp-name")).toHaveValue("外部で変更 2");
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    await page.getByTestId("rp-name").fill("自分の変更");
    await external("外部で変更 3");
    await expect(page.locator(".server-change-banner")).toBeVisible();
    await page.locator(".scb-btn-dismiss").click();
    await saveEdit(page);
    await expect.poll(async () => (await read("product-list")).name, { timeout: 10000 }).toBe("自分の変更");
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
  });

  test("帳票を編集中は、その参照先の画面の改名が止められる (編集中の変更を古い参照で上書きしないため) @regression", async ({ page }) => {
    await openBrowserSessionWorkspace(ws.workspacePath);
    await openEditor(page, "delivery-note", true);
    await expect(sendBrowserRequest("renameEntityId", { entityType: "screen", oldId: "order-complete", newId: "order-complete-y" })).rejects.toThrow(/delivery-note/);
    await page.getByTestId("edit-mode-discard").click();
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("edit-mode-state")).toContainText("閲覧中");
    await sendBrowserRequest("renameEntityId", { entityType: "screen", oldId: "order-complete", newId: "order-complete-y" });
    await expect.poll(async () => (await read("delivery-note")).trigger.screenRef).toBe("order-complete-y");
    // 後続のテスト (改名の追従) が元の ID を使うので戻す
    await sendBrowserRequest("renameEntityId", { entityType: "screen", oldId: "order-complete-y", newId: "order-complete" });
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
    await expect(page.locator(".server-change-banner")).toHaveCount(0);
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
  });

  test("部の一覧は持ち手で、用紙の見本の項目は同じ部の中でドラッグして並べ替えられる @regression", async ({ page }) => {
    await openEditor(page, "delivery-note", true);
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
    await saveEdit(page);
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    expect((await read("delivery-note")).sections.map((s: { id: string }) => s.id)).toEqual([secIds[1], secIds[2], secIds[0], ...secIds.slice(3)]);

    // 用紙の見本: 項目を同じ部の中で動かす。落とす位置 (項目の左半分 = 前 / 右半分 = 後ろ) が、結果の並びと一致する
    const detail = (await read("delivery-note")).sections.find((s: { kind: string }) => s.kind === "detail");
    const ids: string[] = detail.fields.map((f: { id: string }) => f.id);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    const [f1, f2, f3, f4, f5] = ids;
    const paperOrder = () => page.locator('section[data-section="lines"] .rp-row:not(.rp-labels)').first().locator("[data-field]").evaluateAll((els) => els.map((x) => x.getAttribute("data-field")));
    const drop = async (from: string, to: string, half: "left" | "right") => {
      const target = page.getByTestId(`rp-field-${to}`).first();
      await expect(target).toBeVisible();
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      if (!box) throw new Error(`項目 ${to} が見つかりません`);
      await page.getByTestId(`rp-field-${from}`).first().dragTo(target, { targetPosition: { x: half === "left" ? 4 : box.width - 4, y: 4 } });
    };
    await drop(f1, f3, "left");   // a を c の前へ        → b a c d e
    await expect.poll(paperOrder).toEqual([f2, f1, f3, f4, f5]);
    await drop(f5, f2, "right");  // e を b の後ろへ      → b e a c d
    await expect.poll(paperOrder).toEqual([f2, f5, f1, f3, f4]);
    await drop(f2, f4, "right");  // b を d の後ろへ      → e a c d b
    await expect.poll(paperOrder).toEqual([f5, f1, f3, f4, f2]);
    await drop(f4, f5, "left");   // d を e の前へ        → d e a c b
    await expect.poll(paperOrder).toEqual([f4, f5, f1, f3, f2]);
    await drop(f4, f5, "left");   // すでにその位置なら、並びは変わらない
    await expect.poll(paperOrder).toEqual([f4, f5, f1, f3, f2]);
    await saveEdit(page);
    await expect(page.getByTestId("rp-dirty")).toHaveCount(0);
    const after = (await read("delivery-note")).sections.find((s: { kind: string }) => s.kind === "detail").fields.map((f: { id: string }) => f.id);
    expect(after).toEqual([f4, f5, f1, f3, f2, ...ids.slice(5)]);
  });

  test("設計書に「帳票」の章 (用紙の見本と項目定義) が出る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/document");
    await expect(page.locator("#reports")).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".hd-rp .rp-paper").first()).toBeVisible();
  });
});
