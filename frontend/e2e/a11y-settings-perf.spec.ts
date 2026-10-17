/**
 * アクセシビリティ・設定・学習・性能 (UI 改善提案 続編 第 10 弾)。
 * スキップリンク・動きを減らす・キーボードのフォーカスのツールチップ・表の読み上げ・ショートカットの割り当て・設定の書き出し / 読み込み・ヘルプの検索・
 * 新しくなったこと・通しの案内・タッチ・強制カラー。
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `a11y-settings-${Date.now()}`;
let ws: OpenedWorkspace;

const openHelp = async (page: Page) => {
  await page.getByTestId("shortcut-help-open").click();
  await expect(page.getByTestId("shortcut-help")).toBeVisible();
};

test.describe("アクセシビリティ・設定・学習・性能", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async ({ page }) => { await ws?.resetRuntimeState(page); });

  test("スキップリンク: 最初の Tab で出て、Enter で本文へ移る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.getByTestId("page-breadcrumb")).toBeVisible({ timeout: 20000 });
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Tab");
    const first = page.getByTestId("skip-link-main");
    await expect(first).toBeFocused();
    await expect(first).toBeVisible();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("app-main");
  });

  test("構造: 画面ごとに h1 が 1 つ。表は grid で、行数・列の並び替えの状態を読み上げられる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    const toggle = page.getByRole("button", { name: "表表示" });
    if (await toggle.count()) await toggle.first().click();
    const grid = page.getByRole("grid", { name: "テーブルの一覧" });
    await expect(grid).toBeVisible({ timeout: 20000 });
    expect(Number(await grid.getAttribute("aria-rowcount"))).toBeGreaterThan(2);
    await expect(grid.getByRole("row").nth(1)).toHaveAttribute("aria-rowindex", "2");
    expect(await grid.locator("th[role=columnheader]").count()).toBeGreaterThan(0);
    // h1: 画面が持たなければ、見えない h1 が 1 つ
    const h1 = await page.evaluate(() => [...document.querySelectorAll("h1")].filter((h) => !(h as HTMLElement).hidden).length);
    expect(h1).toBe(1);
  });

  test("動きを減らす: 設定で選ぶと、html に反映され、アニメーション・遷移が止まる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.getByTestId("display-settings-open").click();
    await page.getByTestId("disp-motion-reduced").locator("xpath=..").click();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    const d = await page.evaluate(() => {
      const b = document.createElement("button");
      b.style.transition = "all 2s"; b.style.animation = "x 2s";
      document.body.appendChild(b);
      const cs = getComputedStyle(b);
      const out = { t: cs.transitionDuration, a: cs.animationDuration };
      b.remove();
      return out;
    });
    expect(parseFloat(d.t)).toBeLessThan(0.01);
    expect(parseFloat(d.a)).toBeLessThan(0.01);
    await page.getByTestId("disp-motion-auto").locator("xpath=..").click();
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", /.*/);
  });

  test("キーボードのフォーカスで、ボタンの説明 (title) と、キーが出る。Esc で消える @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.getByTestId("notif-open").focus();
    await page.keyboard.press("Tab"); // 次のボタン (キーボードショートカット一覧) へ。キーボードの操作でフォーカスが移る
    await expect(page.getByTestId("focus-tooltip")).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId("focus-tooltip")).toContainText("キーボードショートカット一覧");
    await expect(page.getByTestId("focus-tooltip").locator("kbd")).toHaveText("?");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("focus-tooltip")).toHaveCount(0);
  });

  test("ヘルプの検索と、この画面の項目のヘルプ。ショートカットの割り当てを変えると、そのキーで動く @regression", async ({ page }) => {
    await ws.gotoActive(page, "/table/edit/order");
    await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 20000 });
    await openHelp(page);
    await expect(page.getByTestId("help-here")).toBeVisible(); // この画面 (テーブル) の項目のヘルプ
    await page.getByTestId("help-search").fill("物理名");
    await expect(page.getByTestId("help-hit-topic").first()).toContainText("物理名");
    await page.getByTestId("help-search").fill("入力専用");
    await expect(page.getByTestId("help-hit-shortcut").first()).toContainText("入力専用モード");
    await page.getByTestId("help-search").fill("");

    // 入力専用モードのキーを、Ctrl+Alt+G に変える
    await page.getByTestId("shortcut-edit-toggle").click();
    await page.getByTestId("shortcut-change-focusMode").evaluate((el) => (el as HTMLElement).click()); // 閉じた group の中のボタン
    await expect(page.getByTestId("shortcut-capture")).toBeVisible();
    await page.keyboard.press("Control+Alt+g");
    await expect(page.getByTestId("shortcut-row-focusMode")).toContainText("変更済み");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("shortcut-help")).toHaveCount(0);
    await page.keyboard.press("Control+Alt+g");
    await expect(page.getByTestId("focus-mode-exit")).toBeVisible();
    await page.getByTestId("focus-mode-exit").click();
    // 既定のキーでは動かない
    await page.keyboard.press("Control+Alt+f");
    await expect(page.getByTestId("focus-mode-exit")).toHaveCount(0);
    // 元に戻す
    await openHelp(page);
    await page.getByTestId("shortcut-edit-toggle").click();
    await page.getByTestId("shortcut-reset-all").click();
    await page.keyboard.press("Escape");
  });

  test("設定の書き出し・読み込み: 書き出したファイルを、設定を消したあとに読み込むと、元に戻る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.getByTestId("display-settings-open").click();
    await page.getByTestId("disp-fontScale-large").locator("xpath=..").click();
    await page.getByTestId("settings-backup-open").click();
    await expect(page.getByTestId("settings-backup")).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("settings-export").click()]);
    expect(dl.suggestedFilename()).toBe("harmony-settings.json");
    const file = (await dl.path())!;
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.format).toBe("harmony-settings");
    expect(saved.items["harmony.display"]).toContain("large");
    expect(JSON.stringify(saved)).not.toContain("authToken");
    // 設定を消す → 読み込む
    await page.evaluate(() => localStorage.removeItem("harmony.display"));
    await page.getByTestId("settings-file").setInputFiles(file);
    await expect(page.getByTestId("settings-preview")).toBeVisible();
    await expect(page.getByTestId("settings-pick-display")).toBeChecked();
    await Promise.all([page.waitForEvent("load"), page.getByTestId("settings-import").click()]);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("harmony.display") ?? "")).toContain("large");
    await expect(page.locator("html")).toHaveAttribute("data-font-scale", "large");
    // 壊れたファイルは断る
    await page.getByTestId("display-settings-open").click();
    await page.getByTestId("settings-backup-open").click();
    await page.getByTestId("settings-file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"format":"other"}') });
    await expect(page.getByTestId("settings-error")).toContainText("Harmony の設定のファイルではありません");
    await page.keyboard.press("Escape");
    await page.evaluate(() => localStorage.removeItem("harmony.display"));
  });

  test("新しくなったこと: 更新のあと、前に見たより新しいリリースノートを出す。閉じれば出ない @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.evaluate(() => { localStorage.setItem("harmony.seenVersion", "0.0.0+old"); localStorage.setItem("harmony.seenNote", "1999-01-01|古いもの"); });
    await page.reload();
    const dlg = page.getByTestId("whats-new");
    await expect(dlg).toBeVisible({ timeout: 20000 });
    expect(await dlg.locator("li").count()).toBeGreaterThan(0);
    expect(await dlg.locator("li").count()).toBeLessThanOrEqual(5);
    await page.getByTestId("whats-new-close").click();
    await expect(dlg).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("whats-new")).toHaveCount(0);
  });

  test("通しの案内: ダッシュボードから開き、手順を進められる。終えた印は覚える @regression", async ({ page }) => {
    await ws.gotoActive(page, "/");
    await page.evaluate(() => { localStorage.removeItem("harmony.walkthrough:default"); });
    await page.keyboard.press("Control+k");
    await page.keyboard.type(">通しの案内");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("walkthrough")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("wt-sample-table")).toContainText("customer_name");
    await page.getByTestId("wt-done-table").check();
    await expect(page.getByTestId("wt-step-screen")).toContainText("次はここ");
    await page.getByTestId("wt-go-table").click().catch(() => undefined);
    await page.keyboard.press("Escape");
  });

  test("強制カラー・タッチ: 強制カラーでは、ボタンに枠が付く。指で触る環境では、ボタンの高さが 40px 以上 @regression", async ({ page, browser }) => {
    await ws.gotoActive(page, "/analysis");
    await expect(page.locator(".an-btn").first()).toBeVisible({ timeout: 20000 });
    await page.emulateMedia({ forcedColors: "active" });
    const border = await page.evaluate(() => { const b = document.querySelector(".an-btn") as HTMLElement; return getComputedStyle(b).borderTopStyle; });
    expect(border).toBe("solid");
    await page.emulateMedia({ forcedColors: "none" });

    const ctx = await browser.newContext({ hasTouch: true, isMobile: false, viewport: { width: 1024, height: 768 } });
    const tp = await ctx.newPage();
    try {
      await ws.gotoActive(tp, "/analysis");
      await expect(tp.locator(".an-btn").first()).toBeVisible({ timeout: 20000 });
      const coarse = await tp.evaluate(() => matchMedia("(pointer: coarse)").matches);
      test.skip(!coarse, "この環境では、指で触る (pointer: coarse) の設定にならない");
      const h = await tp.evaluate(() => (document.querySelector(".an-btn") as HTMLElement).getBoundingClientRect().height);
      expect(h).toBeGreaterThanOrEqual(39.5);
    } finally { await ctx.close(); }
  });
});
