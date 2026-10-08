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
    // 未配置の項目を再現するため、出荷指示の「追跡番号」の部品を画面から外す (項目の定義は残す)
    {
      const p = path.join(ws.workspacePath, "harmony", "screens", "shipment-dispatch.json");
      const s = JSON.parse(await fs.readFile(p, "utf-8"));
      const strip = (ns: Array<{ itemRef?: string; children?: unknown[] }>): Array<{ itemRef?: string; children?: unknown[] }> =>
        ns.filter((n) => n.itemRef !== "trackingNumber").map((n) => (n.children ? { ...n, children: strip(n.children as typeof ns) } : n));
      s.layout.nodes = strip(s.layout.nodes);
      await fs.writeFile(p, JSON.stringify(s, null, 2));
    }
    // 未移行 (旧デザインのみ) の画面を再現するため、一部の画面から layout を外し、旧形式 (GrapesJS) のデザインを置く
    // (サンプルは旧デザインを持たないので、変換の入力はテストの中で作る)
    const legacyHtml = [
      '<main><h1>カート</h1><form>',
      '<label for="addProductCode">商品コード</label>',
      '<input type="text" id="addProductCode" data-item-id="addProductCode" maxlength="20">',
      '<button type="submit" id="addToCartButton" data-item-id="addToCartButton" class="btn btn-primary">カートに追加</button>',
      '</form></main>',
    ].join("\n");
    for (const id of ["cart", "order-complete", "store-master"]) {
      const dir = path.join(ws.workspacePath, "harmony", "screens");
      const p = path.join(dir, `${id}.json`);
      const s = JSON.parse(await fs.readFile(p, "utf-8"));
      delete s.layout;
      if (id === "cart") {
        s.design = { designFileRef: "cart.design.json" };
        await fs.writeFile(path.join(dir, "cart.design.json"), JSON.stringify({ pages: [{ frames: [{ component: { type: "wrapper", components: legacyHtml } }] }] }, null, 2));
      }
      await fs.writeFile(p, JSON.stringify(s, null, 2));
    }
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("画面を開いただけでは原本 (設計内容) が変わらない @regression", async ({ page }) => {
    // backend は初回アクセス時に $schema の相対パスを補正し updatedAt を更新することがあるため、
    // それ以外の設計内容 (項目・レイアウト・メタ情報) を比較する
    const semantic = async () => {
      const { $schema: _s, updatedAt: _u, ...rest } = await readScreen("cart") as unknown as Record<string, unknown>;
      void _s; void _u;
      return rest;
    };
    const before = await semantic();
    await openDesigner(page, "cart");
    await expect(page.getByTestId("layout-start")).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await semantic()).toEqual(before);
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

  test("移行済みの画面は業務部品デザイナで開き、部品を移動して保存できる @regression", async ({ page }) => {
    await openDesigner(page, "product-search");
    await expect(page.getByTestId("layout-canvas")).toBeVisible();
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
    // 最上位の見出しを選択し、Alt+↓ で 1 つ後ろへ移動
    const before = (await readScreen("product-search")).layout!.nodes.map((n) => n.id as string);
    await page.getByTestId(`layout-node-${before[0]}`).click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Alt+ArrowDown");
    await save(page, "product-search", (s) => s.layout!.nodes[1]?.id === before[0]);
    expect((await readScreen("product-search")).layout!.nodes[0].id).toBe(before[1]);
  });

  test("未配置の項目を自動で配置し、保存できる @regression", async ({ page }) => {
    // shipment-dispatch は項目 trackingNumber が画面のどこにも置かれていない
    await openDesigner(page, "shipment-dispatch");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("layout-palette-tab-items").click();
    await expect(page.getByTestId("layout-unplaced-trackingNumber")).toBeVisible();

    await page.getByTestId("layout-auto-place").click();
    await expect(page.getByTestId("layout-unplaced-trackingNumber")).toHaveCount(0);
    await expect(page.getByTestId("layout-auto-place")).toHaveCount(0); // 未配置が無くなればボタンも消える
    await expect(page.getByTestId("layout-node-trackingNumber")).toBeVisible();

    await save(page, "shipment-dispatch", (s) => JSON.stringify(s.layout).includes('"itemRef":"trackingNumber"'));
    const s = await readScreen("shipment-dispatch");
    const flat = (ns: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
      ns.flatMap((n) => [n, ...flat((n.children as Array<Record<string, unknown>> | undefined) ?? [])]);
    const hit = (ns: Array<Record<string, unknown>>) => flat(ns).find((n) => n.itemRef === "trackingNumber");
    expect(hit(s.layout!.nodes)).toMatchObject({ type: "field", itemRef: "trackingNumber" });
    await page.getByTestId("edit-mode-discard").click();
    await page.getByTestId("discard-confirm").click();
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
