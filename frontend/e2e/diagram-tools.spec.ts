/**
 * 図・可視化 (UI 改善提案 続編 第 7 弾): ER 図・画面フロー・つながり図の道具 (検索・強調・絞り込み・整列・凡例・書き出し・差分・表示位置の記憶)、
 * 処理フローの「図で見る」、業務フローの SVG 書き出し。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `diagram-tools-${Date.now()}`;
let ws: OpenedWorkspace;

async function openEr(page: Page) {
  await ws.gotoActive(page, "/table/er");
  await expect(page.getByTestId("diagram-tools")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".react-flow__node-erTableNode").first()).toBeVisible({ timeout: 20000 });
}
const tool = (page: Page, name: string) => page.getByTestId(`dgm-${name}`);
const visibleNodes = (page: Page) => page.locator(".react-flow__node-erTableNode").count();

test.describe("図の道具", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("ER 図: Ctrl+F で図の中を検索し、一致を強調してほかを薄くする。Enter で次へ寄る", async ({ page }) => {
    await openEr(page);
    await page.locator(".react-flow__pane").click({ position: { x: 600, y: 60 } });
    await page.keyboard.press("Control+f");
    const input = page.getByTestId("dgm-search-input");
    await expect(input).toBeFocused();
    await input.fill("order");
    await expect(page.getByTestId("dgm-search-count")).toContainText("2 件が一致");
    await expect(page.locator(".react-flow__node.dgm-hit")).toHaveCount(2);
    await expect(page.locator(".react-flow__node.dgm-dim").first()).toBeVisible();
    await input.press("Enter");
    await expect(page.getByTestId("dgm-search-count")).toContainText("2 件目");
    await input.fill("存在しない名前");
    await expect(page.getByTestId("dgm-search-count")).toContainText("一致するものがありません");
    await input.press("Escape");
    await expect(page.locator(".react-flow__node.dgm-dim")).toHaveCount(0);
  });

  test("ER 図: 選んだテーブルとつながるものを強調し、関連 1 段だけ表示に絞れる。戻せる", async ({ page }) => {
    await openEr(page);
    const total = await visibleNodes(page);
    expect(total).toBe(8);
    await page.locator(".react-flow__node-erTableNode").filter({ hasText: "customers" }).first().click({ position: { x: 20, y: 10 } });
    await tool(page, "focus").click();
    await page.getByTestId("dgm-focus-1").check();
    await expect(page.locator(".react-flow__node.dgm-focus")).not.toHaveCount(0);
    await expect(page.locator(".react-flow__node.dgm-dim")).not.toHaveCount(0);
    await page.getByTestId("dgm-focus-0").check();

    await tool(page, "view").click();
    await page.getByTestId("dgm-scope-1").click();
    await expect.poll(() => visibleNodes(page)).toBeLessThan(total);
    await expect(page.getByTestId("dgm-hidden-note")).toBeVisible();
    await page.getByTestId("dgm-scope-clear").click();
    await expect.poll(() => visibleNodes(page)).toBe(total);
  });

  test("ER 図: カラムの表示 (テーブル名だけ)・線の種類・線の形を切り替えられ、開き直しても覚えている", async ({ page }) => {
    await openEr(page);
    await expect(page.locator(".er-col").first()).toBeVisible();
    await tool(page, "view").click();
    await page.getByTestId("dgm-column-mode").selectOption("none");
    await expect(page.locator(".er-col")).toHaveCount(0);
    await page.getByTestId("dgm-edge-shape").selectOption("step");
    await page.getByTestId("dgm-kind-logical").uncheck();
    await page.reload();
    await expect(page.locator(".react-flow__node-erTableNode").first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".er-col")).toHaveCount(0); // 覚えている
    await tool(page, "view").click();
    await expect(page.getByTestId("dgm-column-mode")).toHaveValue("none");
    await expect(page.getByTestId("dgm-edge-shape")).toHaveValue("step");
    // もとに戻す
    await page.getByTestId("dgm-column-mode").selectOption("default");
    await page.getByTestId("dgm-edge-shape").selectOption("default");
    await page.getByTestId("dgm-kind-logical").check();
    await expect(page.locator(".er-col").first()).toBeVisible();
  });

  test("ER 図: 凡例・画像 (PNG) の書き出し・Mermaid のコピー・印刷の設定", async ({ page }) => {
    await openEr(page);
    await tool(page, "legend").click();
    await expect(page.getByTestId("dgm-legend-pop")).toContainText("物理リレーション");
    await tool(page, "export").click();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId("dgm-export-png").click()]);
    expect(dl.suggestedFilename()).toBe("er-diagram.png");
    const png = (await import("node:fs")).readFileSync((await dl.path())!);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(5000); // 空の画像ではない
    await page.getByTestId("dgm-copy-mermaid").click();
    await expect(page.getByText("Mermaid の図をコピーしました")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("dgm-paper")).toHaveValue("A4");
    await expect(page.getByTestId("dgm-orientation")).toHaveValue("landscape");
  });

  test("ER 図: 表示位置と拡大率を覚える (開き直しても、見ていた場所のまま)", async ({ page }) => {
    await openEr(page);
    await page.locator(".react-flow__pane").click({ position: { x: 600, y: 60 } });
    await page.keyboard.press("0");
    await expect.poll(async () => (await page.getByTestId("diagram-zoom-level").textContent()) ?? "").toBe("100%");
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator(".react-flow__node-erTableNode").first()).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => (await page.getByTestId("diagram-zoom-level").textContent()) ?? "", { timeout: 10000 }).toBe("100%");
  });

  test("ER 図: 基準を記録すると、差分の件数が出る。基準をやめられる", async ({ page }) => {
    await openEr(page);
    await tool(page, "export").click();
    await page.getByTestId("dgm-baseline-record").click();
    await expect(page.getByTestId("dgm-diff-summary")).toContainText("追加 0 件 ・ 変更 0 件 ・ 削除 0 件");
    await page.reload();
    await expect(page.locator(".react-flow__node-erTableNode").first()).toBeVisible({ timeout: 20000 });
    await tool(page, "export").click();
    await expect(page.getByTestId("dgm-diff")).toBeVisible(); // 基準は覚えている
    await page.getByTestId("dgm-baseline-clear").click();
    await expect(page.getByTestId("dgm-baseline-record")).toBeVisible();
  });

  test("図: ] でつながっているノードへ移り、[ で戻る", async ({ page }) => {
    await openEr(page);
    const node = page.locator(".react-flow__node-erTableNode").filter({ hasText: "customers" }).first();
    await node.click({ position: { x: 20, y: 10 } });
    await expect(page.locator(".react-flow__node-erTableNode.selected, .react-flow__node-erTableNode[aria-selected='true']")).toHaveCount(1);
    await page.keyboard.press("]");
    await expect(node).not.toHaveClass(/selected/);
    await expect(page.locator(".react-flow__node-erTableNode.selected")).toHaveCount(1);
    await page.keyboard.press("[");
    await expect(node).toHaveClass(/selected/);
  });

  test("ER 図: 編集中は、複数のテーブルを選んで整列・等間隔にできる (Ctrl+Z で戻る)", async ({ page }) => {
    await openEr(page);
    // 編集できるのは、編集中だけ (右上の編集のメニューから、新しい編集を始める)
    await page.getByTestId("esd-toggle-btn").click();
    await page.getByTestId("esd-new-draft-btn").click();
    await expect(page.getByRole("button", { name: /保存/ }).first()).toBeVisible({ timeout: 10000 });
    const nodes = page.locator(".react-flow__node-erTableNode");
    await nodes.nth(0).click({ position: { x: 20, y: 10 } });
    await nodes.nth(1).click({ position: { x: 20, y: 10 }, modifiers: ["Control"] });
    await nodes.nth(2).click({ position: { x: 20, y: 10 }, modifiers: ["Control"] });
    await tool(page, "align").click();
    await page.getByTestId("dgm-align-left").click();
    const lefts = await page.locator(".react-flow__node-erTableNode.selected").evaluateAll((els) => els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().left)));
    expect(lefts.length).toBe(3);
    expect(new Set(lefts).size).toBe(1);
  });

  test("ER 図: 編集中、ほかのテーブルの左端に近づけるとガイド線が出て、離すと吸い付く", async ({ page }) => {
    await openEr(page);
    await page.getByTestId("esd-toggle-btn").click();
    await page.getByTestId("esd-new-draft-btn").click();
    await expect(page.getByRole("button", { name: /保存/ }).first()).toBeVisible({ timeout: 10000 });
    await page.locator(".react-flow__pane").click({ position: { x: 600, y: 60 } });
    await page.keyboard.press("f");
    await page.waitForTimeout(500);
    const a = page.locator('.react-flow__node[data-id="customer-master"]');
    const b = page.locator('.react-flow__node[data-id="product-master"]');
    const ba = (await a.boundingBox())!;
    const bb = (await b.boundingBox())!;
    // a の左端が、b の左端より 3px 左になる位置まで、真横に動かす (しきい値 6px 以内)。ドラッグの遅れを見ながら、足りないぶんを足す
    let mx = ba.x + 30;
    const my = ba.y + 12;
    await page.mouse.move(mx, my);
    await page.mouse.down();
    for (let round = 0; round < 6; round++) {
      const gap = (bb.x - 3) - (await a.boundingBox())!.x;
      if (Math.abs(gap) < 1) break;
      for (let i = 1; i <= 8; i++) { await page.mouse.move(mx + (gap * i) / 8, my); await page.waitForTimeout(15); }
      mx += gap;
      await page.waitForTimeout(60);
    }
    await expect(page.locator(".dgm-guide-v").first()).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId("dgm-guides")).toHaveCount(0);
    await expect.poll(async () => Math.abs(((await a.boundingBox())!.x) - ((await b.boundingBox())!.x)) < 1.5).toBe(true);
  });

  test("画面フロー: グループを畳むと、中の画面と線を隠す。戻せる", async ({ page }) => {
    await ws.gotoActive(page, "/screen/flow");
    await expect(page.locator(".react-flow__node-screenNode").first()).toBeVisible({ timeout: 20000 });
    const before = await page.locator(".react-flow__node-screenNode").count();
    await tool(page, "view").click();
    const first = page.getByTestId("dgm-collapse-customer-facing");
    const label = page.getByText("顧客向け を畳む");
    await label.click();
    await expect(first).toBeChecked();
    await expect.poll(() => page.locator(".react-flow__node-screenNode").count()).toBeLessThan(before);
    await expect(page.getByText("(畳んでいます)")).toBeVisible();
    await label.click();
    await expect(first).not.toBeChecked();
    await expect.poll(() => page.locator(".react-flow__node-screenNode").count()).toBe(before);
  });

  test("画面フロー: 自動配置・検索・凡例・書き出しが使える", async ({ page }) => {
    await ws.gotoActive(page, "/screen/flow");
    await expect(page.getByTestId("diagram-tools")).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".react-flow__node-screenNode").first()).toBeVisible({ timeout: 20000 });
    await tool(page, "legend").click();
    await expect(page.getByTestId("dgm-legend-pop")).toContainText("遷移");
    await tool(page, "search").click();
    await page.getByTestId("dgm-search-input").fill("カート");
    await expect(page.locator(".react-flow__node.dgm-hit").first()).toBeVisible();
    await page.getByTestId("dgm-search-input").press("Escape");
    // 編集を始めると、自動配置のボタンが出る
    const start = page.getByTestId("edit-mode-start");
    if (await start.isVisible().catch(() => false)) await start.click();
    await expect(page.getByTestId("flow-auto-layout")).toBeVisible({ timeout: 10000 });
    const lefts = async () => page.locator(".react-flow__node-screenNode").evaluateAll((els) => els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().left)));
    // 1 つの画面を、ドラッグで大きく動かしてから、自動配置する (動かした画面が、遷移の向きに沿った位置へ戻る)
    await page.locator(".react-flow__pane").click({ position: { x: 600, y: 300 } });
    await page.keyboard.press("f"); // 全体を収めて、すべての画面を画面の中に入れる
    await page.waitForTimeout(500);
    const first = page.locator(".react-flow__node-screenNode").first();
    const box = (await first.boundingBox())!;
    const before = await lefts();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(box.x + box.width / 2 - i * 6, box.y + box.height / 2 + i * 5); await page.waitForTimeout(10); }
    await page.mouse.up();
    await expect.poll(async () => JSON.stringify(await lefts())).not.toBe(JSON.stringify(before));
    const moved = await lefts();
    await page.getByTestId("flow-auto-layout").click();
    await expect.poll(async () => JSON.stringify(await lefts())).not.toBe(JSON.stringify(moved));
    await expect(page.getByText("画面とグループを自動で並べました")).toBeVisible();
  });

  test("つながり図: 設計全体のつながりを見て、種類で絞り、検索できる", async ({ page }) => {
    await ws.gotoActive(page, "/analysis");
    await page.getByTestId("an-tab-graph").click();
    await expect(page.getByTestId("an-graph")).toBeVisible({ timeout: 20000 });
    const nodes = page.locator(".an-graph .react-flow__node");
    await expect(nodes.first()).toBeVisible({ timeout: 20000 });
    const before = await nodes.count();
    expect(before).toBeGreaterThan(10);
    // 種類を外す (テーブル)
    await page.getByTestId("an-graph-kind-table").uncheck();
    await expect.poll(() => nodes.count()).toBeLessThan(before);
    await page.getByTestId("an-graph-kind-table").check();
    await expect.poll(() => nodes.count()).toBe(before);
    // 検索
    await tool(page, "search").click();
    await page.getByTestId("dgm-search-input").fill("注文");
    await expect(page.locator(".an-graph .react-flow__node.dgm-hit").first()).toBeVisible();
  });

  test("処理フロー: 「図で見る」で、流れ図とシーケンス図を見られる (SVG の保存・文のコピー)", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("flow-diagram-open").click();
    const dlg = page.getByTestId("flow-diagram-dialog");
    await expect(dlg).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("fdd-svg").locator("svg")).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("fdd-save-svg").click()]);
    expect(dl.suggestedFilename()).toMatch(/\.svg$/);
    const svg = (await import("node:fs")).readFileSync((await dl.path())!, "utf8");
    expect(svg).toContain("<svg");
    await page.getByTestId("fdd-tab-sequence").click();
    await expect(page.getByTestId("fdd-sequence-text")).toContainText("sequenceDiagram");
    await expect(page.getByTestId("fdd-sequence-text")).toContainText("participant");
    await page.getByTestId("fdd-format").selectOption("plantuml");
    await expect(page.getByTestId("fdd-sequence-text")).toContainText("@startuml");
    await page.getByTestId("fdd-copy-sequence").click();
    await expect(page.getByText("シーケンス図の文をコピーしました")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  });

  test("業務フロー: 図を SVG で保存し、Mermaid をコピーできる", async ({ page }) => {
    await ws.gotoActive(page, "/business-flow/edit/order-to-shipment");
    await expect(page.getByTestId("bf-diagram")).toBeVisible({ timeout: 20000 });
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("bf-export-svg").click()]);
    expect(dl.suggestedFilename()).toBe("order-to-shipment.svg");
    await page.getByTestId("bf-copy-mermaid").click();
    await expect(page.getByText("Mermaid の図をコピーしました")).toBeVisible();
  });
});
