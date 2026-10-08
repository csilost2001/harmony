/**
 * プロジェクト独自部品の E2E。
 *
 * - 画面の部品を選んで「独自部品として登録」→ 画面の部品が参照部品に置き換わり、定義が保存される
 * - 別の画面にパレットから置き、差し込み口 (画面項目) を設定して保存する
 * - 「定義を編集」で定義を直して保存できる (名前・差し込み口の追加)
 * - 空の独自部品を新規作成し、差し込み口を文言に差し込める
 * - 「展開して通常の部品にする」で定義とのつながりを切れる
 * - 使用中の独自部品は確認のうえ削除できる
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `layout-components-${Date.now()}`;
let ws: OpenedWorkspace;

type Node = { id: string; type: string; componentRef?: string; args?: Record<string, string>; children?: Node[] };
const screenFile = (id: string) => path.join(ws.workspacePath, "harmony", "screens", `${id}.json`);
const componentsFile = () => path.join(ws.workspacePath, "harmony", "layout-components.json");
const readScreen = async (id: string): Promise<{ layout: { nodes: Node[] } }> => JSON.parse(await fs.readFile(screenFile(id), "utf-8"));
const readComponents = async (): Promise<{ components: Array<{ id: string; label: string; params: Array<{ id: string; kind: string }>; nodes: Node[] }> }> => {
  try { return JSON.parse(await fs.readFile(componentsFile(), "utf-8")); } catch { return { components: [] }; }
};
const flat = (ns: Node[]): Node[] => ns.flatMap((n) => [n, ...flat(n.children ?? [])]);

async function openDesigner(page: Page, screenId: string) {
  await ws.gotoActive(page, `/screen/design/${screenId}`);
  const designer = page.getByTestId("screen-layout-designer");
  await expect(designer).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("layout-canvas")).toBeVisible();
}
async function startEditing(page: Page) {
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
}
async function save(page: Page) { await page.getByTestId("edit-mode-save").click(); }
/**
 * 保存後も編集セッションは継続する (spec §159)。同じ画面を別のテストでもう一度保存すると
 * 「別の編集セッションで更新されています」の上書き確認になるため、保存したテストの最後で編集を終える。
 */
async function endEditing(page: Page) {
  await page.getByTestId("edit-mode-discard").click();
  await page.getByTestId("discard-confirm").click();
  await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 10000 });
}

test.describe("プロジェクト独自部品", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("画面の部品を独自部品として登録すると、参照部品に置き換わり定義が保存される @regression", async ({ page }) => {
    await openDesigner(page, "product-search");
    await startEditing(page);
    await page.getByTestId("layout-node-searchPanel2").click({ position: { x: 5, y: 5 } });
    await page.getByTestId("layout-register-component").click();
    await expect(page.getByTestId("register-component-dialog")).toBeVisible();

    // 画面項目は既定で差し込み口に選ばれている
    const params = page.getByTestId("register-params");
    await expect(params).toContainText("productCode");
    await expect(params).toContainText("searchInventoryButton");
    await expect(page.getByTestId("register-param-on-0")).toBeChecked();

    await expect(page.getByTestId("register-submit")).toBeDisabled(); // 名前が未入力
    await page.getByTestId("register-label").fill("商品検索パネル");
    await page.getByTestId("register-id").fill("product-search-panel");
    await page.getByTestId("register-submit").click();

    await expect(page.getByTestId("register-component-dialog")).toBeHidden();
    await expect(page.getByTestId("layout-component-product-search-panel")).toBeVisible(); // パレットに並ぶ
    // キャンバスでは展開して見える。元の部品の ID を引き継ぐ
    const node = page.getByTestId("layout-node-searchPanel2");
    await expect(node).toHaveAttribute("data-node-type", "component");
    await expect(node).toContainText("商品コード");

    await save(page);
    await expect.poll(async () => (await readScreen("product-search")).layout.nodes.some((n) => n.id === "searchPanel2" && n.type === "component"), { timeout: 10000 }).toBe(true);

    const ref = (await readScreen("product-search")).layout.nodes.find((n) => n.id === "searchPanel2")!;
    expect(ref).toMatchObject({ componentRef: "product-search-panel", args: { productCode: "productCode", storeCode: "storeCode", searchInventoryButton: "searchInventoryButton" } });
    expect(ref.children).toBeUndefined();
    const def = (await readComponents()).components.find((c) => c.id === "product-search-panel")!;
    expect(def.params.map((p) => p.id)).toEqual(expect.arrayContaining(["productCode", "storeCode", "searchInventoryButton"]));
    expect(JSON.stringify(def.nodes)).toContain("{{productCode}}");
    expect(JSON.stringify(def.nodes)).not.toContain('"itemRef":"productCode"');
  });

  test("別の画面にパレットから置き、差し込み口を設定して保存できる @regression", async ({ page }) => {
    await openDesigner(page, "inventory-list");
    await startEditing(page);
    await page.getByTestId("layout-component-product-search-panel").click();
    const placed = page.locator('[data-node-type="component"]');
    await expect(placed).toHaveCount(1);
    // 未設定の差し込み口は警告になる
    await expect(page.getByTestId("layout-component-panel")).toBeVisible();

    await page.getByTestId("layout-arg-productCode").selectOption("productCodeFilter");
    await page.getByTestId("layout-arg-storeCode").selectOption("storeFilter");
    await page.getByTestId("layout-arg-searchInventoryButton").selectOption("");
    await expect(placed).toContainText("商品コード");

    await save(page);
    await expect.poll(async () => flat((await readScreen("inventory-list")).layout.nodes).some((n) => n.type === "component" && n.args?.productCode === "productCodeFilter"), { timeout: 10000 }).toBe(true);
    const ref = flat((await readScreen("inventory-list")).layout.nodes).find((n) => n.type === "component")!;
    expect(ref).toMatchObject({ componentRef: "product-search-panel", args: { productCode: "productCodeFilter", storeCode: "storeFilter" } });
    await endEditing(page);
  });

  test("「定義を編集」で定義を直して保存でき、使っている画面に反映される @regression", async ({ page }) => {
    await openDesigner(page, "inventory-list");
    await startEditing(page);
    await page.locator('[data-node-type="component"]').click({ position: { x: 5, y: 5 } });
    await page.getByTestId("layout-edit-component").click();
    await expect(page.getByTestId("component-editor")).toBeVisible();

    await page.getByTestId("component-label").fill("商品検索パネル (改)");
    await page.getByTestId("component-label").blur();
    await page.getByTestId("component-add-param").click();
    await expect(page.getByTestId("component-param-param4")).toBeVisible();
    await page.getByTestId("component-save").click();
    await expect.poll(async () => (await readComponents()).components.find((c) => c.id === "product-search-panel")?.label, { timeout: 10000 }).toBe("商品検索パネル (改)");
    expect((await readComponents()).components[0].params.map((p) => p.id)).toContain("param4");

    // 保存済みの差し込み口の ID は変えられない。追加したばかりのものは保存後に固定される
    await expect(page.getByTestId("component-param-productCode").locator("input.sld-mono")).toBeDisabled();
    await page.getByTestId("component-close").click();
    await expect(page.getByTestId("component-editor")).toBeHidden();
    // 定義の変更が画面のパレットと詳細に反映される
    await expect(page.getByTestId("layout-component-product-search-panel")).toContainText("商品検索パネル (改)");
  });

  test("空の独自部品を新規作成し、差し込み口を文言に差し込める @regression", async ({ page }) => {
    await openDesigner(page, "inventory-list");
    await page.getByTestId("layout-manage-components").click();
    await expect(page.getByTestId("component-manager")).toBeVisible();
    // 商品検索と在庫一覧の 2 画面で使っている
    await expect(page.getByTestId("component-row-product-search-panel")).toContainText("2 画面");

    await page.getByTestId("component-new").click();
    await page.getByTestId("component-new-label").fill("お知らせ");
    await page.getByTestId("component-new-id").fill("Bad Id");
    await expect(page.getByTestId("component-new-submit")).toBeDisabled();
    await page.getByTestId("component-new-id").fill("notice-box");
    await page.getByTestId("component-new-submit").click();
    await expect(page.getByTestId("component-editor")).toBeVisible();

    // 差し込み口 (文言) を追加し、文章の部品に差し込む
    const editor = page.getByTestId("component-editor");
    await editor.getByTestId("component-add-param").click();
    await editor.getByTestId("layout-part-text").click();
    await editor.getByTestId("layout-param-chip-text-param1").click();
    await expect(editor.locator("#sld-text")).toHaveValue(/\{\{param1\}\}/);
    await page.getByTestId("component-save").click();
    await expect.poll(async () => (await readComponents()).components.some((c) => c.id === "notice-box"), { timeout: 10000 }).toBe(true);
    const def = (await readComponents()).components.find((c) => c.id === "notice-box")!;
    expect(def.params).toMatchObject([{ id: "param1", kind: "text" }]);
    expect(JSON.stringify(def.nodes)).toContain("{{param1}}");
    await page.getByTestId("component-close").click();
    await page.getByRole("button", { name: "閉じる" }).first().click();
  });

  test("「展開して通常の部品にする」で定義とのつながりを切れる。使用中の部品は確認して削除できる @regression", async ({ page }) => {
    await openDesigner(page, "inventory-list");
    await startEditing(page);
    await page.locator('[data-node-type="component"]').click({ position: { x: 5, y: 5 } });
    await page.getByTestId("layout-detach-component").click();
    await expect(page.locator('[data-node-type="component"]')).toHaveCount(0);
    await expect(page.locator('[data-node-type="search-panel"]')).toHaveCount(2); // 展開された検索パネル + 元からある検索パネル
    await save(page);
    await expect.poll(async () => flat((await readScreen("inventory-list")).layout.nodes).some((n) => n.type === "component"), { timeout: 10000 }).toBe(false);
    const nodes = flat((await readScreen("inventory-list")).layout.nodes);
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length); // 展開後も部品 ID は重ならない
    await endEditing(page);

    // product-search がまだ使っているので、削除は確認つき
    await page.getByTestId("layout-manage-components").click();
    await expect(page.getByTestId("component-row-product-search-panel")).toContainText("1 画面");
    page.once("dialog", (d) => { expect(d.message()).toContain("商品検索"); void d.accept(); });
    await page.getByTestId("component-delete-product-search-panel").click();
    await expect(page.getByTestId("component-row-product-search-panel")).toBeHidden();
    await expect.poll(async () => (await readComponents()).components.some((c) => c.id === "product-search-panel"), { timeout: 10000 }).toBe(false);
    // 使われていない部品は確認なしで削除できる
    await page.getByTestId("component-delete-notice-box").click();
    await expect(page.getByTestId("component-row-notice-box")).toBeHidden();
    await expect(page.getByTestId("component-empty")).toBeVisible();
  });
});
