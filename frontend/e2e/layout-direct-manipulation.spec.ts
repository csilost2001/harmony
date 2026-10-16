/**
 * 業務部品デザイナの直接操作 (UI 改善提案 第 3 弾 #41〜#44 / #58):
 * 文言をその場で直す・右クリックのメニュー・複数選択と一括操作・段の幅の調整。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `layout-direct-${Date.now()}`;
let ws: OpenedWorkspace;
type Node = { id: string; type: string; itemRef?: string; props?: Record<string, unknown>; children?: Node[] };
type Screen = { items: Array<Record<string, unknown>>; layout: { nodes: Node[] } };

async function readScreen(id: string): Promise<Screen> {
  return JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony", "screens", `${id}.json`), "utf-8"));
}
const find = (nodes: Node[], id: string): Node | undefined => {
  for (const n of nodes) { if (n.id === id) return n; const c = n.children && find(n.children, id); if (c) return c; }
};

async function openEditing(page: Page, screenId: string) {
  await ws.gotoActive(page, `/screen/design/${screenId}`);
  const banner = page.getByTestId("legacy-back-to-layout");
  const designer = page.getByTestId("screen-layout-designer");
  await expect(banner.or(designer)).toBeVisible({ timeout: 15000 });
  if (await banner.isVisible()) await banner.click();
  await expect(page.getByTestId("layout-canvas")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
}
async function save(page: Page, screenId: string, done: (s: Screen) => boolean) {
  await page.getByTestId("edit-mode-save").click();
  await expect.poll(async () => done(await readScreen(screenId)), { timeout: 10000 }).toBe(true);
}
/** 部品の見出し部分 (入れ物の中の別の部品に当たらない位置) をクリックする */
const nodeLoc = (page: Page, id: string) => page.getByTestId(`layout-node-${id}`);

test.describe("画面デザイナの直接操作", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("文言をダブルクリックでその場で直す (Enter 確定・Esc 取り消し・Tab で次の文言へ) @regression", async ({ page }) => {
    await openEditing(page, "shipment-dispatch");
    // 見出し: ダブルクリック → 直して Enter
    await nodeLoc(page, "heading").dblclick({ position: { x: 20, y: 8 } });
    const editor = page.getByTestId("layout-inline-editor");
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue("配送指示");
    await editor.fill("出荷の指示");
    await editor.press("Enter");
    await expect(editor).toHaveCount(0);
    await expect(nodeLoc(page, "heading").locator("h1")).toHaveText("出荷の指示");

    // Esc は取り消し (書き換えない)
    await nodeLoc(page, "heading").dblclick({ position: { x: 20, y: 8 } });
    await page.getByTestId("layout-inline-editor").fill("消えるはずの文言");
    await page.getByTestId("layout-inline-editor").press("Escape");
    await expect(nodeLoc(page, "heading").locator("h1")).toHaveText("出荷の指示");

    // F2 で始め、Tab で次の文言 (区画の表題) へ移って、そこで直す
    await nodeLoc(page, "heading").click({ position: { x: 20, y: 8 } });
    await page.keyboard.press("F2");
    await expect(page.getByTestId("layout-inline-editor")).toHaveValue("出荷の指示");
    await page.getByTestId("layout-inline-editor").press("Tab");
    await expect(page.getByTestId("layout-inline-editor")).toBeVisible();
    await page.getByTestId("layout-inline-editor").fill("注文の詳細");
    await page.getByTestId("layout-inline-editor").press("Enter");

    // 項目の表示名も、紙面から直せる (項目の定義が書き換わる)
    await nodeLoc(page, "orderId").dblclick({ position: { x: 10, y: 10 } });
    await page.getByTestId("layout-inline-editor").fill("注文の番号");
    await page.getByTestId("layout-inline-editor").press("Enter");

    await save(page, "shipment-dispatch", (s) => s.items.some((i) => i.id === "orderId" && i.label === "注文の番号"));
    const s = await readScreen("shipment-dispatch");
    expect(find(s.layout.nodes, "heading")?.props?.text).toBe("出荷の指示");
    expect(find(s.layout.nodes, "section")?.props?.title).toBe("注文の詳細");
    expect(find(s.layout.nodes, "orderId")?.props).toBeUndefined(); // 表示名は項目の側に書く
  });

  test("右クリック / Shift+F10 のメニューで、複製・包む・削除ができる @regression", async ({ page }) => {
    await openEditing(page, "order-list");
    const before = await readScreen("order-list");
    const kids = find(before.layout.nodes, "searchPanel")!.children!.length;

    await nodeLoc(page, "customerNameFilter").click({ button: "right", position: { x: 10, y: 10 } });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId("list-context-menu-item-inline")).toBeVisible();
    await menu.getByTestId("list-context-menu-item-dup").click();
    await expect(menu).toHaveCount(0);
    await save(page, "order-list", (s) => (find(s.layout.nodes, "searchPanel")?.children?.length ?? 0) === kids + 1);

    // キーボード: 選んだ部品で Shift+F10 → 区画で包む
    await nodeLoc(page, "orderNumberFilter").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByTestId("list-context-menu-item-wrap-section").click();
    await save(page, "order-list", (s) => !!find(s.layout.nodes, "searchPanel")?.children?.some((c) => c.type === "section" && c.children?.[0]?.id === "orderNumberFilter"));

    // 削除 (右クリック → 削除)。Esc でメニューだけを閉じられる
    await nodeLoc(page, "statusFilter").click({ button: "right", position: { x: 10, y: 10 } });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(nodeLoc(page, "statusFilter")).toBeVisible();
    await nodeLoc(page, "statusFilter").click({ button: "right", position: { x: 10, y: 10 } });
    await page.getByTestId("list-context-menu-item-del").click();
    await save(page, "order-list", (s) => !find(s.layout.nodes, "statusFilter"));
  });

  test("Ctrl+クリックで複数の部品を選び、共通の属性をまとめて変え、まとめて削除できる @regression", async ({ page }) => {
    await openEditing(page, "product-search");
    await nodeLoc(page, "productCode").click({ position: { x: 10, y: 10 } });
    await nodeLoc(page, "storeCode").click({ position: { x: 10, y: 10 }, modifiers: ["Control"] });
    await expect(page.getByTestId("layout-multi-panel")).toContainText("2 件を選択中");
    await page.getByTestId("layout-multi-required-on").click();
    await page.getByTestId("layout-multi-readonly-on").click();
    await save(page, "product-search", (s) => ["productCode", "storeCode"].every((id) => s.items.find((i) => i.id === id)?.required === true));
    const s = await readScreen("product-search");
    expect(s.items.find((i) => i.id === "productCode")).toMatchObject({ required: true, readonly: true });
    expect(s.items.find((i) => i.id === "totalCount")?.required).not.toBe(true); // 選んでいない項目は変わらない

    // Shift+クリックの範囲 → まとめて削除 (その部品だけが使っていた項目も消える)
    await nodeLoc(page, "productCode").click({ position: { x: 10, y: 10 } });
    await nodeLoc(page, "storeCode").click({ position: { x: 10, y: 10 }, modifiers: ["Shift"] });
    await expect(page.getByTestId("layout-multi-panel")).toContainText("2 件を選択中");
    await page.keyboard.press("Delete");
    await save(page, "product-search", (x) => !find(x.layout.nodes, "productCode") && !find(x.layout.nodes, "storeCode"));
    const after = await readScreen("product-search");
    expect(after.items.some((i) => i.id === "productCode")).toBe(false);
    expect(find(after.layout.nodes, "searchPanel2")).toBeTruthy();
  });

  test("段の幅を、境界のドラッグと Alt+Shift+←→ で変えられる (値は右の欄にも出る) @regression", async ({ page }) => {
    await openEditing(page, "cart");
    // キーボード: 左の段 (8) を選び、Alt+Shift+→ で 1 つぶん広げる (右の段は 4 → 3)
    await nodeLoc(page, "addItemForm").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("ArrowLeft"); // ← = 親 (段) を選ぶ
    await expect(page.locator("#sld-span")).toHaveValue("8");
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await expect(page.locator("#sld-span")).toHaveValue("9");
    // ドラッグ: 境界のつまみを左へ動かして、狭める
    const handle = page.getByTestId("layout-col-handle-column4");
    await expect(handle).toBeVisible();
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 250, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    const span = Number(await page.locator("#sld-span").inputValue());
    expect(span).toBeLessThan(9);
    await save(page, "cart", (s) => find(s.layout.nodes, "column4")?.props?.span === span);
    const s = await readScreen("cart");
    expect((find(s.layout.nodes, "column4")!.props!.span as number) + (find(s.layout.nodes, "column5")!.props!.span as number)).toBe(12); // 合計は変わらない
  });
});
