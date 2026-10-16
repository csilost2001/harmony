/**
 * 一覧・探索・見通し (UI 改善提案 続編 第 6 弾)。
 * タブの履歴・パンくず・保存した絞り込み・グループ表示・のぞき見・書き出し・まとめての操作・Ctrl+K の接頭辞・今日やること。
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `list-navigation-${Date.now()}`;
let ws: OpenedWorkspace;

/** テーブル一覧を表表示で開く (retail の 8 テーブル: マスタ 3 / トランザクション 5) */
async function openTableList(page: Page) {
  await ws.gotoActive(page, "/table/list");
  const toggle = page.getByRole("button", { name: "表表示" });
  if (await toggle.count()) await toggle.first().click();
  await expect(page.getByTestId("data-list-colmenu")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("data-list-row").first()).toBeVisible({ timeout: 15000 });
}
const rowCount = (page: Page) => page.getByTestId("data-list-row").count();
const search = (page: Page) => page.getByPlaceholder(/絞り込み/).first();

test.describe("一覧・探索・見通し", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("閉じたタブを開き直し、前に見ていたタブへ戻る / 進める。パンくずから一覧へ移れる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order");
    await expect(page.getByTestId("page-breadcrumb")).toContainText("テーブル一覧");
    await expect(page.getByTestId("page-breadcrumb")).toContainText("データ");

    // パンくずの「テーブル一覧」を押すと、一覧のタブへ移る
    await page.getByTestId("breadcrumb-link").click();
    await expect(page).toHaveURL(/\/table\/list/);
    await expect(page.getByTestId("page-breadcrumb")).not.toContainText("注文");
    // 画面の切り替え直後は、アプリが URL と作業状態を整える間 (約 1 秒) がある。続けて切り替えるときは、その間をおく
    const settle = () => page.waitForTimeout(1500);
    await settle();

    // 履歴: 戻る → 注文のテーブル、進む → 一覧
    await page.getByTestId("tab-history-back").click();
    await expect(page).toHaveURL(/\/table\/edit\/order/);
    await settle();
    await page.getByTestId("tab-history-forward").click();
    await expect(page).toHaveURL(/\/table\/list/);
    await settle();
    // キーでも (Ctrl+Alt+←)
    await page.keyboard.press("Control+Alt+ArrowLeft");
    await expect(page).toHaveURL(/\/table\/edit\/order/);
    await settle();

    // タブを閉じて、開き直す (Ctrl+Alt+T)
    await page.locator('[data-tab-id="table:order"] .tabbar-tab-close').click();
    await expect(page.locator('[data-tab-id="table:order"]')).toHaveCount(0);
    await expect(page.getByTestId("tab-reopen-btn")).toBeEnabled();
    await settle();
    await page.keyboard.press("Control+Alt+t");
    await expect(page.locator('[data-tab-id="table:order"]')).toHaveCount(1);
    await expect(page).toHaveURL(/\/table\/edit\/order/);
    await settle();

    // 閉じたタブの一覧から選んで開く
    await page.locator('[data-tab-id="table:order"] .tabbar-tab-close').click();
    await page.getByTestId("tab-reopen-btn").click();
    await expect(page.getByTestId("tab-closed-menu")).toBeVisible();
    await page.getByTestId("tab-closed-item").first().click();
    await expect(page.locator('[data-tab-id="table:order"]')).toHaveCount(1);
  });

  test("同じ設計をもう一度開こうとすると、新しいタブを作らず、既存のタブが光る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order");
    await expect(page.locator('[data-tab-id="table:order"]')).toHaveCount(1);
    await page.waitForTimeout(1500);
    await page.keyboard.press("Control+k");
    await page.getByTestId("quick-open-input").fill("t:order");
    await expect(page.locator('[data-testid="quick-open-item"][data-key="table:order"]')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tab-flash")).toHaveCount(1);
    await expect(page.locator('[data-tab-id="table:order"]')).toHaveCount(1); // 増えていない
  });

  test("一覧: 検索語がチップになり、名前を付けて保存・呼び出し・削除できる @regression", async ({ page }) => {
    await openTableList(page);
    const all = await rowCount(page);
    expect(all).toBe(8);
    await expect(page.getByTestId("list-view-bar")).toHaveCount(0); // 何も絞っていなければ出ない

    await search(page).fill("マスタ");
    await expect(page.getByTestId("list-view-chip")).toContainText("マスタ");
    expect(await rowCount(page)).toBe(3);

    await page.getByTestId("list-view-save-open").click();
    await page.getByTestId("list-view-name").fill("マスタだけ");
    await page.getByTestId("list-view-save").click();
    await expect(page.getByTestId("list-view-saved")).toHaveText("マスタだけ");
    await expect(page.getByTestId("list-view-saved")).toHaveAttribute("aria-pressed", "true");

    // チップの × で外すと全件に戻る。保存した絞り込みを押すと、また 3 件
    await page.getByRole("button", { name: "検索語を外す" }).click();
    await expect.poll(() => rowCount(page)).toBe(8);
    await page.getByTestId("list-view-saved").click();
    await expect.poll(() => rowCount(page)).toBe(3);
    await expect(search(page)).toHaveValue("マスタ");

    // 開き直しても残っている
    await page.reload();
    await expect(page.getByTestId("data-list-colmenu")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("list-view-saved")).toHaveText("マスタだけ");

    await page.getByTestId("list-view-saved-del").click();
    await expect(page.getByTestId("list-view-saved")).toHaveCount(0);
  });

  test("一覧: グループ表示(カテゴリ)で見出しが挟まり、見出しで畳める @regression", async ({ page }) => {
    await openTableList(page);
    await page.getByTestId("data-list-group-btn").click();
    await page.getByRole("menuitem", { name: "カテゴリでまとめる" }).click();
    const heads = page.getByTestId("data-list-group");
    await expect(heads).toHaveCount(2);
    await expect(heads.first()).toContainText("カテゴリ: マスタ");
    await expect(heads.first()).toContainText("3 件");
    await expect(heads.nth(1)).toContainText("トランザクション");
    expect(await rowCount(page)).toBe(8);

    // 畳む
    await heads.first().getByTestId("data-list-group-toggle").click();
    await expect.poll(() => rowCount(page)).toBe(5);
    await heads.first().getByTestId("data-list-group-toggle").click();
    await expect.poll(() => rowCount(page)).toBe(8);

    // 覚えている / まとめないに戻せる
    await page.reload();
    await expect(page.getByTestId("data-list-group")).toHaveCount(2, { timeout: 15000 });
    await page.getByTestId("data-list-group-btn").click();
    await page.getByRole("menuitem", { name: "まとめない" }).click();
    await expect(page.getByTestId("data-list-group")).toHaveCount(0);
  });

  test("一覧: Space でのぞき見(クイックルック)。↑↓で行を変え、Esc で閉じる / Alt+ホバーでも出る @regression", async ({ page }) => {
    await openTableList(page);
    const first = page.getByTestId("data-list-row").first();
    await first.click();
    await page.keyboard.press("Space");
    const peek = page.getByTestId("list-peek");
    await expect(peek).toBeVisible();
    const t1 = await peek.locator(".list-peek-title").innerText();
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => peek.locator(".list-peek-title").innerText()).not.toBe(t1);
    await page.keyboard.press("Escape");
    await expect(peek).toHaveCount(0);
    // Esc は選択を解除しない(のぞき見を閉じただけ)
    await expect(page.locator(".data-list-row.selected")).toHaveCount(1);

    // Alt+ホバー
    const row = page.getByTestId("data-list-row").nth(2);
    await row.hover();
    await page.keyboard.down("Alt");
    await row.hover({ position: { x: 20, y: 6 } });
    await expect(page.getByTestId("list-peek")).toBeVisible();
    await page.keyboard.up("Alt");
    await expect(page.getByTestId("list-peek")).toHaveCount(0);
  });

  test("一覧: CSV と Excel ファイルで保存できる(選んだ行だけにも絞れる) @regression", async ({ page }) => {
    await openTableList(page);
    await page.getByTestId("data-list-copymenu").click();
    const csvItem = page.getByRole("menuitem", { name: /CSV ファイルで保存/ });
    await expect(csvItem).toContainText("すべての 8 行");
    const [dl] = await Promise.all([page.waitForEvent("download"), csvItem.click()]);
    expect(dl.suggestedFilename()).toMatch(/^table-list-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = (await import("node:fs")).readFileSync((await dl.path())!, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff); // Excel で文字化けしない BOM
    expect(text.split("\r\n").length).toBe(9); // 見出し + 8 行
    expect(text).toContain("顧客マスタ");

    await page.getByTestId("data-list-row").first().click();
    await page.getByTestId("data-list-copymenu").click();
    await expect(page.getByRole("menuitem", { name: /Excel ファイル/ })).toContainText("選んだ 1 行");
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /Excel ファイル/ }).click()]);
    expect(dl2.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("一覧: 複数選ぶと、お気に入り・マーカーをまとめて付けられる @regression", async ({ page }) => {
    await openTableList(page);
    await page.getByTestId("data-list-row").nth(0).click();
    await page.getByTestId("data-list-row").nth(1).click({ modifiers: ["Control"] });
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toContainText("2 件を選択中");
    await page.getByTestId("selection-bar-fav").click();
    await expect(page.getByTestId("selection-bar-fav")).toContainText("お気に入りから外す");
    await page.getByTestId("selection-bar-fav").click();
    await expect(page.getByTestId("selection-bar-fav")).toContainText("お気に入りに追加");

    // マーカーを 2 件に付ける
    await page.getByTestId("selection-bar-marker").click();
    await page.getByTestId("selection-bar-marker-body").fill("命名規約に合わせて直して");
    await page.getByTestId("selection-bar-marker-add").click();
    await expect(page.getByText(/2 件の設計にマーカーを付けました/)).toBeVisible({ timeout: 15000 });
  });

  test("一覧: 最近開いた順に並べ、検索で 0 件のときは近い名前が出る。名前の重なりに印が付く @regression", async ({ page }) => {
    // 2 つのテーブルをこの順に開く → 一覧で最近開いた順にすると、あとから開いたものが先頭
    await ws.gotoActive(page, "/table/edit/store-master");
    await expect(page.locator('[data-tab-id="table:store-master"]')).toHaveCount(1);
    await ws.gotoActive(page, "/table/edit/cart");
    await expect(page.locator('[data-tab-id="table:cart"]')).toHaveCount(1);
    await openTableList(page);
    await page.getByTestId("data-list-recent").click();
    await expect(page.getByTestId("data-list-row").first()).toHaveAttribute("data-row-id", "cart");
    await expect(page.getByTestId("data-list-row").nth(1)).toHaveAttribute("data-row-id", "store-master");
    await page.getByTestId("data-list-recent").click(); // もう一度で元の並び
    await expect(page.getByTestId("data-list-row").first()).not.toHaveAttribute("data-row-id", "cart");

    // 近い名前
    await search(page).fill("顧客マスタア");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByTestId("empty-state-near-item").first()).toContainText("顧客マスタ");
    await page.getByTestId("empty-state-near-item").first().click();
    await expect(search(page)).toHaveValue("顧客マスタ");
    await expect.poll(() => rowCount(page)).toBeGreaterThanOrEqual(1);
    // retail の名前・ID はそろっているので、印は付かない
    await expect(page.getByTestId("data-list-row-mark")).toHaveCount(0);
  });

  test("Ctrl+K: 種類の接頭辞(t: f: s:)でその種類だけを探す @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+k");
    const input = page.getByTestId("quick-open-input");
    await input.fill("t:注文");
    await expect(page.getByTestId("quick-open-prefix-head")).toContainText("テーブルだけ");
    await expect(page.getByTestId("quick-open-item").first()).toBeVisible({ timeout: 15000 });
    const keys = await page.getByTestId("quick-open-item").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key!));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith("table:"))).toBe(true);
    await input.fill("f:");
    await expect(page.getByTestId("quick-open-item").first()).toHaveAttribute("data-key", /^process-flow:/);
    const fkeys = await page.getByTestId("quick-open-item").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.key!));
    expect(fkeys.length).toBeGreaterThan(0);
    expect(fkeys.every((k) => k.startsWith("process-flow:"))).toBe(true);
    // 接頭辞でない語はふつうに探す
    await input.fill("x:order");
    await expect(page.getByTestId("quick-open-prefix-head")).toHaveCount(0);
  });

  test("ダッシュボード: 今日やることを開き、パネルを隠して戻し、初期の配置に戻せる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await expect(page.getByTestId("today-panel").or(page.getByTestId("today-empty"))).toBeVisible({ timeout: 20000 });
    // パネルを隠す
    await expect(page.getByTestId("panel-handle-favorites")).toBeVisible();
    await page.getByTestId("panel-handle-favorites").hover();
    await page.getByTestId("panel-hide-favorites").click();
    await expect(page.getByTestId("panel-handle-favorites")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("panel-handle-today")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("panel-handle-favorites")).toHaveCount(0); // 覚えている
    // 戻す
    await page.getByTestId("dashboard-panels-btn").click();
    await page.getByTestId("dashboard-panels-menu").getByLabel("お気に入り").check();
    await expect(page.getByTestId("panel-handle-favorites")).toBeVisible();
    // 初期化
    await page.getByTestId("panel-handle-recent-edits").hover();
    await page.getByTestId("panel-hide-recent-edits").click();
    await expect(page.getByTestId("panel-handle-recent-edits")).toHaveCount(0);
    if (!(await page.getByTestId("dashboard-panels-menu").isVisible())) await page.getByTestId("dashboard-panels-btn").click();
    await page.getByTestId("dashboard-reset").click();
    await expect(page.getByTestId("panel-handle-recent-edits")).toBeVisible();
  });

  test("参照元ダイアログに「この設計が使っているもの」が出る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("references-open-btn").click();
    const uses = page.getByTestId("references-uses");
    await expect(uses).toBeVisible({ timeout: 20000 });
    await expect(uses.locator("li").first()).toBeVisible();
  });
});
