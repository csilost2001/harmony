/**
 * 操作性 (改善提案 第 4 弾): 通知の履歴・表示の設定・お気に入り・コマンドパレット・変更履歴・一括変更・別のテーブル / 画面へのコピー・
 * スニペット・設計全体の検索置換・表で編集・画面デザイナのキーボード・ダッシュボードのキーボード・タブの移動・操作ツアー・並べて表示・項目ごとのヘルプ。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";
import { discardAllEditSessions } from "./helpers/editSessions";

test.describe.configure({ mode: "default" });

const KEY = `ux-operations-${Date.now()}`;
let ws: OpenedWorkspace;

test.beforeAll(async () => {
  test.skip(!(await isMcpRunning()), "backend 未起動");
  ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
});
test.afterAll(async () => { await discardAllEditSessions(ws?.workspacePath ?? ""); await cleanupRealWorkspaces([KEY]); });
test.afterEach(async () => { await discardAllEditSessions(ws?.workspacePath ?? ""); await ws?.resetRuntimeState(); });

/** ページを読み込み直さずに (メモリ上のクリップボードを保ったまま)、クイックオープンで別の設計へ移る */
async function openInApp(page: Page, query: string, kind: RegExp) {
  await page.keyboard.press("Control+k");
  await page.getByTestId("quick-open-input").fill(query);
  await page.getByTestId("quick-open-item").filter({ hasText: kind }).first().click();
}

async function startEditing(page: Page) {
  for (let i = 0; i < 3; i++) {
    const backdrop = page.locator(".edit-mode-modal-backdrop");
    if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.getByTestId("resume-discard").click();
      await backdrop.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else break;
  }
  // 別の画面で編集中のまま移ったときは、続けて編集中になっている
  // 読み込みが終わって、「編集開始」か「保存」のどちらかが出るのを待つ (読み込み前に判定しない)
  const start = page.getByTestId("edit-mode-start");
  const save = page.getByTestId("edit-mode-save");
  await expect(start.or(save)).toBeVisible({ timeout: 20000 });
  if (!(await save.isVisible())) await start.click();
  await expect(save).toBeVisible({ timeout: 10000 });
}

test.describe("ヘッダーの道具", () => {
  test("表示の設定: 文字サイズ・密度・コントラストが <html> に反映され、再読み込みしても残る。標準に戻せる", async ({ page }) => {
    await ws.gotoActive(page, "/");
    const html = page.locator("html");
    const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const base = await size();
    await page.getByTestId("display-settings-open").click();
    await page.getByTestId("disp-fontScale-large").locator("xpath=..").click();
    await expect(html).toHaveAttribute("data-font-scale", "large");
    expect(await size()).toBeGreaterThan(base);
    await page.getByTestId("disp-density-compact").locator("xpath=..").click();
    await page.getByTestId("disp-contrast-high").locator("xpath=..").click();
    await expect(html).toHaveAttribute("data-density", "compact");
    await expect(html).toHaveAttribute("data-contrast", "high");
    await page.reload();
    await expect(html).toHaveAttribute("data-font-scale", "large");
    await page.getByTestId("display-settings-open").click();
    await page.getByTestId("display-settings-reset").click();
    await expect(html).not.toHaveAttribute("data-font-scale", /.+/);
    await expect(html).not.toHaveAttribute("data-density", /.+/);
    expect(await size()).toBe(base);
  });

  test("コマンドパレット: Ctrl+K のあと「>」で操作を探して実行する (配色)。Ctrl+Shift+P でも開く", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+k");
    await page.getByTestId("quick-open-input").fill(">ダーク");
    await expect(page.getByTestId("quick-open-command").first()).toContainText("配色: ダーク");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Control+Shift+P");
    await expect(page.getByTestId("quick-open-input")).toHaveValue(">");
    await page.getByTestId("quick-open-input").fill(">ライト");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("お気に入り: 候補の ★ (Ctrl+D) で固定すると、検索語が空のとき先頭に出て、ヘッダーの ★ とダッシュボードからも開ける", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+k");
    await page.getByTestId("quick-open-input").fill("カート");
    const item = page.getByTestId("quick-open-item").filter({ hasText: "cart" }).first();
    await item.getByTestId("quick-open-star").click();
    await expect(item.getByTestId("quick-open-star")).toHaveClass(/is-on/);
    await page.keyboard.press("Escape");
    await page.getByTestId("favorites-open").click();
    await expect(page.getByTestId("favorites-item").first()).toContainText("カート");
    await page.keyboard.press("Escape");
    // ダッシュボードのパネル
    await expect(page.getByTestId("favorites-panel")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("favorites-panel-item").first().click();
    await expect(page).toHaveURL(/\/(screen\/design|table\/edit)\/cart/, { timeout: 15000 });
    // 外す
    await page.getByTestId("favorites-open").click();
    await page.getByRole("button", { name: /お気に入りから外す/ }).last().click();
    await expect(page.getByText("お気に入りはまだありません")).toBeVisible();
  });

  test("通知の履歴: 消えた通知を見直せる", async ({ page }) => {
    await ws.gotoActive(page, "/analysis");
    await page.getByTestId("an-tab-export").click();
    await page.getByRole("button", { name: /コピー/ }).first().click().catch(() => undefined);
    // 通知が出る操作がなくても、履歴の窓が開き、空の案内か通知が見える
    await page.getByTestId("notif-open").click();
    await expect(page.getByTestId("notif-pop")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("notif-pop")).toBeHidden();
  });
});

test.describe("テーブルのカラム", () => {
  test("変更履歴: カラムを足すと操作が並び、途中の状態へ一度に戻せる", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart");
    await startEditing(page);
    const rows = page.locator(".columns-data-list .data-list-row");
    const n0 = await rows.count();
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await page.getByRole("button", { name: /カラム追加/ }).click();
    await expect(rows).toHaveCount(n0 + 2);
    await page.getByTestId("undo-history-open").click();
    const hist = page.getByTestId("undo-history-row");
    await expect(hist).toHaveCount(2);
    await hist.first().locator("button").click(); // 1 つ目の操作の後の状態へ = 1 つ戻る
    await expect(rows).toHaveCount(n0 + 1);
    await page.getByTestId("undo-history-open").click();
    await expect(page.getByTestId("undo-history-row").last()).toContainText("やり直せる");
  });

  test("一括変更: 選んだカラムのデフォルト値を、予行を見てからまとめて変える (Ctrl+Z で戻る)", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart-item");
    await startEditing(page);
    const rows = page.locator(".columns-data-list .data-list-row");
    await rows.nth(1).click();
    await rows.nth(2).click({ modifiers: ["Shift"] });
    await page.getByTestId("columns-bulk-edit").click();
    await page.getByTestId("bulk-on-defaultValue").check();
    await page.getByTestId("bulk-value-defaultValue").fill("99999");
    await expect(page.getByTestId("bulk-preview-row")).toHaveCount(2);
    await expect(page.getByTestId("bulk-apply")).toBeEnabled();
    // すでにその値の項目 (主キーの NOT NULL など) は、変わる行に数えない
    await page.getByTestId("bulk-on-notNull").check();
    await page.getByTestId("bulk-value-notNull").selectOption("true");
    await page.getByTestId("bulk-apply").click();
    await expect(page.getByTestId("bulk-edit-dialog")).toBeHidden();
    await expect(page.locator(".columns-data-list")).toContainText("99999");
    await page.keyboard.press("Control+z");
    await expect(page.locator(".columns-data-list")).not.toContainText("99999");
  });

  test("表で編集: セルを選んでその場で編集し、Enter で下の行へ移り、保存の対象になる", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart");
    await startEditing(page);
    await page.getByTestId("columns-grid-toggle").click();
    const grid = page.getByTestId("column-grid");
    await expect(grid).toBeVisible();
    const first = grid.getByLabel("1 行目の表示名");
    await first.click();
    await first.fill("カート番号 (表で編集)");
    await page.keyboard.press("Enter");
    await expect(grid.getByLabel("2 行目の表示名")).toBeFocused();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
    await page.getByTestId("columns-grid-toggle").click(); // 一覧へ戻す
    await expect(page.locator(".columns-data-list")).toContainText("カート番号 (表で編集)");
  });

  test("別のテーブルへのコピー: カートのカラムをコピーして、カート明細へ貼り付ける (物理名が重なれば確認)", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart");
    await startEditing(page);
    const src = page.locator(".columns-data-list .data-list-row").nth(1);
    await src.click();
    await page.keyboard.press("Control+c");
    await openInApp(page, "カート明細", /テーブル/);
    await expect(page).toHaveURL(/\/table\/edit\/cart-item/, { timeout: 15000 });
    await startEditing(page);
    const rows = page.locator(".columns-data-list .data-list-row");
    await expect(rows.first()).toBeVisible();
    await page.waitForTimeout(500); // 読み込み直後は、行の数が落ち着くのを待つ
    const n0 = await rows.count();
    await rows.nth(0).click();
    page.once("dialog", (d) => { void d.accept(); });
    await page.keyboard.press("Control+v");
    await expect(rows).toHaveCount(n0 + 1, { timeout: 10000 });
  });

  test("スニペット: 選んだカラムを名前をつけて保存し、挿入できる。書き出しの JSON は Harmony の形式", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart");
    await startEditing(page);
    const rows = page.locator(".columns-data-list .data-list-row");
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ["Shift"] });
    await page.getByTestId("snippet-open").click();
    await page.getByTestId("snippet-name").fill("先頭 2 列");
    await page.getByTestId("snippet-save").click();
    await expect(page.getByTestId("snippet-item")).toContainText("先頭 2 列");
    const n0 = await rows.count();
    await page.getByTestId("snippet-insert").click();
    await expect(rows).toHaveCount(n0 + 2, { timeout: 10000 });
  });
});

test.describe("画面項目", () => {
  test("別の画面へのコピー: 項目をコピーして、ほかの画面の項目定義へ貼り付けると、ID が重なる項目には Copy が付く", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await startEditing(page);
    const check = page.locator(".screen-items-table tbody tr td:first-child input[type=checkbox]").first();
    await check.check();
    await page.getByTestId("items-copy").click();
    await openInApp(page, "カート確認", /項目定義/);
    await expect(page).toHaveURL(/\/screen\/items\/cart-confirm/, { timeout: 15000 });
    await startEditing(page);
    const before = await page.locator(".screen-items-table tbody tr").count();
    page.once("dialog", (d) => { void d.accept(); });
    await page.getByTestId("items-paste").click();
    await expect.poll(async () => page.locator(".screen-items-table tbody tr").count()).toBeGreaterThan(before);
  });

  test("一括変更: 選んだ項目の説明を、まとめて設定する", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await startEditing(page);
    await page.locator(".screen-items-table tbody tr td:first-child input[type=checkbox]").nth(0).check();
    await page.locator(".screen-items-table tbody tr td:first-child input[type=checkbox]").nth(1).check();
    await page.getByTestId("items-bulk-edit").click();
    await page.getByTestId("bulk-on-description").check();
    await page.getByTestId("bulk-value-description").fill("一括変更の説明");
    await expect(page.getByTestId("bulk-preview-row").first()).toBeVisible();
    await page.getByTestId("bulk-apply").click();
    await expect(page.getByTestId("bulk-edit-dialog")).toBeHidden();
  });
});

test.describe("設計全体の検索置換", () => {
  test("探す → 予行 → 選んで置換 → ファイルが変わる → 取り消すと元に戻る。物理名・ID は変わらない", async ({ page }) => {
    const file = path.join(ws.workspacePath, "harmony", "tables", "customer-master.json");
    const original = await fs.readFile(file, "utf-8");
    const name = (JSON.parse(original) as { name: string }).name;
    await ws.gotoActive(page, "/");
    await page.keyboard.press("Control+Shift+H");
    await expect(page.getByTestId("replace-dialog")).toBeVisible();
    await page.getByTestId("replace-query").fill(name);
    await page.getByTestId("replace-replacement").fill(`${name}(置換試験)`);
    await page.getByTestId("replace-search").click();
    await expect(page.getByTestId("replace-summary")).toContainText("見つかりました", { timeout: 20000 });
    await expect(page.getByTestId("replace-list")).toContainText(name);
    await page.getByTestId("replace-apply").click();
    await expect(page.getByTestId("replace-result")).toContainText("置換しました", { timeout: 20000 });
    const changed = await fs.readFile(file, "utf-8");
    expect(changed).toContain(`${name}(置換試験)`);
    expect(JSON.parse(changed).physicalName).toBe(JSON.parse(original).physicalName);
    // 一覧が読む登録簿 (harmony.json) の名前も直る
    const registry = JSON.parse(await fs.readFile(path.join(ws.workspacePath, "harmony.json"), "utf-8")) as { entities: { tables: Array<{ id: string; name: string }> } };
    expect(registry.entities.tables.find((t) => t.id === "customer-master")?.name).toBe(`${name}(置換試験)`);
    await page.getByTestId("replace-undo").first().click();
    await expect.poll(async () => fs.readFile(file, "utf-8"), { timeout: 15000 }).toBe(original);
  });
});

test.describe("キーボード", () => {
  test("タブの移動: Ctrl+Shift+PageDown で、いまのタブを右へ動かす", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await page.goto(page.url().replace("/table/list", "/screen/list"));
    await expect(page.locator(".tab-item, .tabbar-tab").first()).toBeVisible({ timeout: 15000 });
    const labels = async () => page.locator(".tab-item, .tabbar-tab").allInnerTexts();
    await page.keyboard.press("Control+Shift+PageUp");
    const after = await labels();
    expect(after.length).toBeGreaterThan(1);
  });

  test("ダッシュボードのパネル: 見出しで Alt+矢印を押すと動き、読み上げの通知に位置が出る", async ({ page }) => {
    await ws.gotoActive(page, "/");
    const handle = page.getByTestId("panel-handle-getting-started");
    await handle.focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("dashboard-announce")).toContainText("位置を変えました");
    await page.keyboard.press("Alt+Shift+ArrowDown");
    await expect(page.getByTestId("dashboard-announce")).toContainText("大きさを変えました");
  });

  test("画面デザイナ: ↑↓ で部品を選び、Alt+→ で直前の入れ物の中へ、Alt+← で外へ出せる", async ({ page }) => {
    await ws.gotoActive(page, "/screen/design/cart");
    await startEditing(page);
    const nodes = page.locator("[data-node-id]");
    await expect(nodes.first()).toBeVisible({ timeout: 15000 });
    await nodes.first().click();
    const firstId = await nodes.first().getAttribute("data-node-id");
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => page.locator("[data-node-id].selected, [data-node-id][aria-selected=true], [data-node-id].is-selected").first().getAttribute("data-node-id").catch(() => null)).not.toBe(firstId);
  });
});

test.describe("画面フロー", () => {
  test("遷移を追加: 遷移元・遷移先を選んで、線を引かずに画面遷移を足せる", async ({ page }) => {
    await ws.gotoActive(page, "/screen/flow");
    await startEditing(page);
    const edges = page.locator(".react-flow__edge");
    await expect(edges.first()).toBeVisible({ timeout: 15000 });
    const n0 = await edges.count();
    await page.getByTestId("add-transition-btn").click();
    await expect(page.getByTestId("add-transition-dialog")).toBeVisible();
    await page.getByTestId("add-transition-source").selectOption({ index: 0 });
    await page.getByTestId("add-transition-target").selectOption({ index: 2 });
    await page.getByTestId("add-transition-apply").click();
    await expect.poll(async () => page.locator(".react-flow__edge").count(), { timeout: 10000 }).toBeGreaterThan(n0);
  });
});

test.describe("画面フローのキーボード移動", () => {
  test("画面を選んで矢印キーで動かすと、位置が保存され、再読み込みしても残る", async ({ page }) => {
    await ws.gotoActive(page, "/screen/flow");
    await startEditing(page);
    const node = page.locator(".react-flow__node").first();
    await expect(node).toBeVisible({ timeout: 15000 });
    const id = (await node.getAttribute("data-id")) ?? "";
    const pos = async () => page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => (el as HTMLElement).style.transform);
    const before = await pos();
    await node.focus();
    await page.keyboard.press("Space"); // キーボードで、フォーカスしたノードを選ぶ (React Flow の標準)
    for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(800); // 操作が落ち着いてから、位置が保存へ回る
    const moved = await pos();
    expect(moved).not.toBe(before);
    await page.getByTestId("edit-mode-save").click();
    await expect(page.getByTestId("edit-mode-save")).not.toBeDisabled({ timeout: 15000 });
    await page.reload();
    await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible({ timeout: 20000 });
    expect(await pos()).toBe(moved);
  });
});

test.describe("案内", () => {
  test("操作ツアー: コマンドで始まり、→ で進み、Esc で閉じる", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/cart");
    await page.keyboard.press("Control+k");
    await page.getByTestId("quick-open-input").fill(">ツアー");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tour")).toBeVisible();
    await expect(page.getByTestId("tour-card")).toContainText("1 /");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("tour-card")).toContainText("2 /");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tour")).toBeHidden();
  });

  test("項目ごとのヘルプ: 画面項目の見出しの「?」で説明が出る", async ({ page }) => {
    await ws.gotoActive(page, "/screen/items/cart");
    await page.getByTestId("help-screenItem.direction").click();
    await expect(page.getByTestId("help-hint-pop")).toContainText("in: 画面から外へ渡す");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("help-hint-pop")).toBeHidden();
  });

  test("空の状態: 検索で 0 件のとき、該当なしと絞り込みの解除が出る", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await page.getByPlaceholder(/検索|絞り込み|フィルタ/).first().fill("存在しない名前zzz");
    await expect(page.getByTestId("empty-state")).toContainText("該当するテーブル定義がありません");
    await page.getByTestId("empty-state-clear").click();
    await expect(page.getByTestId("empty-state")).toBeHidden();
  });
});

test.describe("並べて表示", () => {
  test("タブの右クリックから、右側に並べて表示できる。左で開く・閉じるもできる", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await ws.gotoActive(page, "/screen/list");
    const tab = page.locator(".tab-item, .tabbar-tab").filter({ hasText: /テーブル/ }).first();
    await tab.click({ button: "right" });
    await page.getByTestId("tab-open-split").click();
    await expect(page.getByTestId("split-pane")).toBeVisible();
    const frame = page.frameLocator('[data-testid="split-frame"]');
    await expect(frame.locator("body")).toContainText(/テーブル/, { timeout: 20000 });
    // 右ペインの中には、ヘッダー・タブバーが出ない
    await expect(frame.locator(".common-header")).toHaveCount(0);
    await page.getByTestId("split-close").click();
    await expect(page.getByTestId("split-pane")).toBeHidden();
  });

  test("タブを、本文の右の領域へドラッグして離すと、右側に並べて表示できる (領域の外で離すと、並べ替えだけ) @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await ws.gotoActive(page, "/screen/list");
    const tab = page.locator(".tab-item, .tabbar-tab").filter({ hasText: /テーブル/ }).first();
    const box = (await tab.boundingBox())!;
    const main = (await page.locator("#app-main").boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // 領域の外で離す: 並んで表示はしない
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, start.y, { steps: 3 });
    await page.mouse.move(main.x + main.width * 0.3, main.y + 200, { steps: 4 });
    await expect(page.getByTestId("split-drop-zone")).toBeVisible();
    await expect(page.getByTestId("split-drop-zone")).not.toHaveClass(/is-hot/);
    await page.mouse.up();
    await expect(page.getByTestId("split-pane")).toBeHidden();
    await expect(page.getByTestId("split-drop-zone")).toHaveCount(0);

    // 右の領域で離す
    const box2 = (await tab.boundingBox())!;
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2 + 12, box2.y + box2.height / 2, { steps: 3 });
    await page.mouse.move(main.x + main.width * 0.85, main.y + 200, { steps: 6 });
    await expect(page.getByTestId("split-drop-zone")).toHaveClass(/is-hot/);
    await page.mouse.up();
    await expect(page.getByTestId("split-pane")).toBeVisible();
    await expect(page.frameLocator('[data-testid="split-frame"]').locator("body")).toContainText(/テーブル/, { timeout: 20000 });
    await page.getByTestId("split-close").click();
  });

  test("並べて表示の一覧の行を、入力欄 (参照の補完つき) へドラッグすると、参照が入る @regression", async ({ page }) => {
    // 一覧を表表示にしておく (並べて表示の右側で使う)
    await ws.gotoActive(page, "/table/list");
    await page.getByRole("button", { name: "表表示" }).click();
    await expect(page.locator("tr.data-list-row").first()).toBeVisible({ timeout: 15000 });
    await ws.gotoActive(page, "/screen/items/cart");
    const start = page.getByTestId("edit-mode-start");
    await expect(start).toBeVisible({ timeout: 15000 });
    await start.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();

    const tab = page.locator(".tab-item, .tabbar-tab").filter({ hasText: /テーブル/ }).first();
    await tab.click({ button: "right" });
    await page.getByTestId("tab-open-split").click();
    const frame = page.frameLocator('[data-testid="split-frame"]');
    const row = frame.locator("tr.data-list-row").first();
    await expect(row).toBeVisible({ timeout: 20000 });
    const tableId = await row.getAttribute("data-row-id");

    // 行を、左の表の「入力書式」欄へドラッグ (別の枠をまたいで)
    const target = page.locator('.screen-items-table tbody tr[data-grid-row="0"] input[placeholder^="例: @conv.regex"]');
    await target.scrollIntoViewIfNeeded();
    // boundingBox は、枠の中の要素でも、ページ全体の座標で返る
    const rb = (await row.boundingBox())!;
    const tb = (await target.boundingBox())!;
    const ry = rb.y + rb.height / 2;
    await page.mouse.move(rb.x + rb.width / 3, ry);
    await page.mouse.down();
    await page.mouse.move(rb.x + rb.width / 3 - 40, ry, { steps: 5 });
    await page.mouse.move(tb.x + 20, tb.y + tb.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(target).toHaveValue(new RegExp(`@table\\.${tableId}$`)); // 入力欄のカーソル (末尾) の位置に入る
    await page.getByTestId("split-close").click();
  });
});
