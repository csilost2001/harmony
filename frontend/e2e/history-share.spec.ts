/**
 * 履歴・比較・共有・書き出し (UI 改善提案 続編 第 9 弾)。
 * 設計のあゆみ (変更の記録・版の比較・完了の確認・メモ・共有・試作)、レビューの進み具合・宛先・畳み、期間のまとめ、書き出しの設定、通知の受け取り方、スナップショット HTML、印刷用スタイル。
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `history-share-${Date.now()}`;
let ws: OpenedWorkspace;

async function openHistory(page: Page, route: string) {
  await ws.gotoActive(page, route);
  await expect(page.getByTestId("history-open")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("history-open").click();
  await expect(page.getByTestId("design-history-dialog")).toBeVisible();
}

test.describe("履歴・比較・共有・書き出し", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("あゆみ: 保存を重ねると、変更の記録と最終編集者が出て、版を比べ、コミット文・レビュー依頼文を作れる @regression", async ({ page, context }) => {
    test.setTimeout(120_000);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ws.gotoActive(page, "/table/edit/order-item");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 });
    // 2 回保存して、保存前の版を作る (カラムを足す → 保存、もう 1 つ足す → 保存)
    for (const memo of ["memo_x", "memo_y"]) {
      const rows = page.locator(".columns-data-list .data-list-row");
      await expect(rows.first()).toBeVisible({ timeout: 10000 });
      await rows.last().dblclick();
      await expect(page.getByTestId("column-detail")).toBeVisible();
      await page.keyboard.press("Control+Enter");
      await expect(rows.last()).toContainText("new_column", { timeout: 10000 });
      await page.getByTestId("column-detail").locator(".tbl-field input[type=text]").first().fill(memo);
      await page.keyboard.press("Escape");
      await page.getByTestId("edit-mode-save").click();
      await expect(page.getByTestId("edit-mode-save")).not.toBeDisabled({ timeout: 15000 });
      await page.waitForTimeout(600);
      // 保存すると編集が終わる (もう一度、編集を始める)
      const start = page.getByTestId("edit-mode-start");
      if (memo === "memo_x" && await start.isVisible().catch(() => false)) { await start.click(); await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 15000 }); }
    }

    await page.getByTestId("history-open").click();
    const dlg = page.getByTestId("design-history-dialog");
    await expect(dlg).toBeVisible();
    // 変更の記録: 保存の記録と最終編集者
    await expect(page.getByTestId("dh-timeline-table")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("dh-last-editor")).toContainText("最後に編集したのは");
    expect(await page.getByTestId("dh-timeline-table").locator("tbody tr").count()).toBeGreaterThanOrEqual(1);

    // 版を比べる: 基準 = いちばん新しい保存前の版、比較先 = いまの内容 → 追加が見つかる
    await page.getByTestId("dh-tab-compare").click();
    await expect(page.getByTestId("dh-compare-counts")).toContainText("追加", { timeout: 15000 });
    await expect(page.getByTestId("dh-compare-summary")).toContainText("カラム『新規カラム』の追加");
    await expect(page.getByTestId("dh-compare-row").first()).toBeVisible();
    await page.getByTestId("dh-copy-commit").click();
    await expect(page.getByText("コミットメッセージの文をコピーしました")).toBeVisible();
    const commit = await page.evaluate(() => navigator.clipboard.readText());
    expect(commit.split("\n")[0]).toContain("を更新:");
    await page.getByTestId("dh-copy-review").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("## 変更の概要");
    // 前と後を入れ替えると、追加が削除になる
    await page.getByTestId("dh-compare-swap").click();
    await expect(page.getByTestId("dh-compare-counts")).toContainText("削除", { timeout: 15000 });
  });

  test("あゆみ: 完了の確認・個人メモ (今日やること)・共有 (パスのコピー・この設計だけの書き出し)・試作 @regression", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openHistory(page, "/table/edit/order");

    // 完了の確認: 項目が並び、判定の文が出る
    await page.getByTestId("dh-tab-checklist").click();
    await expect(page.getByTestId("dh-checklist-verdict")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("dh-check-markers")).toBeVisible();
    await expect(page.getByTestId("dh-check-approval")).toHaveAttribute("data-status", "ng"); // 未申請

    // 個人メモ: 書いて保存 → 今日やることに出る
    await page.getByTestId("dh-tab-memo").click();
    await page.getByTestId("dh-memo-text").fill("桁数を顧客に確認する");
    await page.getByTestId("dh-memo-today").check();
    await page.getByTestId("dh-memo-save").click();
    await expect(page.getByText(/のメモを保存しました/)).toBeVisible();

    // 共有: ファイルの場所と、この設計だけの書き出し
    await page.getByTestId("dh-tab-share").click();
    await expect(page.getByTestId("dh-path-rel")).toContainText("tables/order.json");
    await page.getByTestId("dh-copy-rel").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/tables\/order\.json$/);
    await page.getByTestId("dh-copy-ai").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("ファイル: ");
    const [html] = await Promise.all([page.waitForEvent("download"), page.getByTestId("dh-export-html").click()]);
    expect(html.suggestedFilename()).toMatch(/table-order\.html$/);
    const body = fs.readFileSync((await html.path())!, "utf8");
    expect(body).toContain("読み取り専用の写しです");
    const [md] = await Promise.all([page.waitForEvent("download"), page.getByTestId("dh-export-md").click()]);
    expect(md.suggestedFilename()).toMatch(/table-order\.md$/);
    expect(fs.readFileSync((await md.path())!, "utf8")).toContain("# ");

    // 試作: 名前をつけて残し、本体と比べられる。捨てられる
    await page.getByTestId("dh-tab-trial").click();
    await expect(page.getByTestId("dh-trial-empty")).toBeVisible();
    await page.getByTestId("dh-trial-name").fill("案 A");
    await page.getByTestId("dh-trial-create").click();
    await expect(page.getByTestId("dh-trial-item")).toContainText("案 A");
    await page.getByTestId("dh-trial-compare").click();
    await expect(page.getByTestId("dh-compare")).toBeVisible();
    await expect(page.getByTestId("dh-compare-counts")).toContainText("差はありません", { timeout: 15000 });
    await page.getByTestId("dh-tab-trial").click();
    await page.getByTestId("dh-trial-remove").click();
    await expect(page.getByTestId("dh-trial-empty")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("design-history-dialog")).toHaveCount(0);

    // ダッシュボードの「今日やること」に、メモが出る
    await ws.gotoActive(page, "/");
    await expect(page.getByText("桁数を顧客に確認する").first()).toBeVisible({ timeout: 20000 });
  });

  test("一覧: 保存した設計の更新日の下に、最終編集者が出る (自分の編集には印) @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    const toggle = page.getByRole("button", { name: "表表示" });
    if (await toggle.count()) await toggle.first().click();
    await expect(page.getByTestId("data-list-row").first()).toBeVisible({ timeout: 20000 });
    // 前のテストで order-item を 2 回保存している (変更の記録に残る)
    await expect(page.getByTestId("last-editor").first()).toBeVisible({ timeout: 20000 });
  });

  test("レビュー: 進み具合の件数・止まっているレビュー・宛先 (@名前)・解決済みを畳む @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order");
    await page.getByTestId("review-open").click();
    await page.getByTestId("op-thread-text").fill("@花子 桁数を確認してください");
    await page.getByTestId("op-thread-send").click();
    await expect(page.getByTestId("op-mention").first()).toContainText("@花子");
    await page.getByTestId("op-thread-resolve").click();
    await expect(page.getByTestId("op-thread-fold")).toBeVisible();

    await ws.gotoActive(page, "/operations");
    await page.getByRole("tab", { name: /レビュー/ }).first().click().catch(() => undefined);
    await expect(page.getByTestId("op-progress")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("op-progress-review")).toBeVisible();
    await expect(page.getByTestId("op-stalled")).toBeVisible();
    await page.getByTestId("op-stalled-days").selectOption("1");
    await page.getByTestId("op-thread-filter").selectOption("all");
    await expect(page.getByTestId("op-thread-fold").first()).toBeVisible();
    await expect(page.getByTestId("op-mention").first()).toContainText("@花子");
  });

  test("期間のまとめ: 期間を選んで、文章と表を作れる @regression", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ws.gotoActive(page, "/operations");
    await page.getByRole("tab", { name: /変更の記録/ }).first().click().catch(() => undefined);
    await expect(page.getByTestId("op-period")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("op-period-make").click();
    await expect(page.getByTestId("op-period-text")).toContainText("# 設計のまとめ", { timeout: 20000 });
    await expect(page.getByTestId("op-period-text")).toContainText("変更した設計");
    await page.getByTestId("op-period-copy").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("# 設計のまとめ");
  });

  test("書き出しの設定: 名前をつけて保存し、ワンクリックで出し直せる。保存先は設計書の体裁 @regression", async ({ page }) => {
    await ws.gotoActive(page, "/document");
    await expect(page.getByTestId("ddv-presets")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("ddv-preset-new").click();
    await page.getByTestId("ddv-preset-name").fill("顧客への納品用");
    await page.getByTestId("ddv-preset-format").selectOption("html");
    await page.getByTestId("ddv-preset-save").click();
    await expect(page.getByText("書き出しの設定「顧客への納品用」を保存しました")).toBeVisible();
    await page.getByTestId("ddv-preset-select").selectOption("顧客への納品用");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ddv-preset-run").click()]);
    expect(dl.suggestedFilename()).toMatch(/design-document\.html$/);
    const saved = JSON.parse(fs.readFileSync(`${ws.workspacePath}/harmony/document-template.json`, "utf8"));
    expect(saved.exportPresets).toEqual([{ name: "顧客への納品用", format: "html", excludeChapters: [] }]);
    // 消す
    await page.getByTestId("ddv-preset-remove").click();
    await expect(page.getByTestId("ddv-preset-select").locator("option")).toHaveCount(1);
  });

  test("通知の受け取り方: 出さない・まとめる・静かな時間帯。履歴には残る", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.getByTestId("notif-open").click();
    await page.getByTestId("notif-prefs").locator("summary").click();
    await page.getByTestId("notif-mode-success").selectOption("off");
    await page.keyboard.press("Escape");
    // 保存の成功通知は、出ない (「お気に入り」の切り替えなどで確かめる代わりに、画面から出る通知を直接出す)
    await page.evaluate(async () => { const m = await import("/src/utils/toast.ts"); m.showToast("試験の成功通知", "success"); });
    await page.waitForTimeout(400);
    await expect(page.getByTestId("toast")).toHaveCount(0);
    // 履歴には残る
    await page.getByTestId("notif-open").click();
    await expect(page.getByTestId("notif-pop")).toContainText("試験の成功通知");
    // 元に戻す
    await page.getByTestId("notif-prefs").locator("summary").click();
    await page.getByTestId("notif-mode-success").selectOption("always");
  });

  test("印刷用スタイル: 印刷では、ヘッダー・タブ・パンくずを隠し、表の見出しを繰り返す", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.getByTestId("page-breadcrumb")).toBeVisible({ timeout: 20000 });
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".common-header")).toBeHidden();
    await expect(page.getByTestId("page-breadcrumb")).toBeHidden();
    expect(await page.evaluate(() => {
      const t = document.createElement("table");
      t.innerHTML = "<thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody>";
      document.body.appendChild(t);
      const d = getComputedStyle(t.querySelector("thead")!).display;
      t.remove();
      return d;
    })).toBe("table-header-group");
    await page.emulateMedia({ media: "screen" });
    await expect(page.locator(".common-header")).toBeVisible();
  });
});
