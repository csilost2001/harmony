/**
 * 設計の分析 (/analysis): 要確認の抑制 (理由つき・ファイルに残る・ダッシュボードに反映)・影響分析・対応表・独自ルール・書き出し。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `design-analysis-${Date.now()}`;
let ws: OpenedWorkspace;
const checkFile = () => path.join(ws.workspacePath, "harmony", "design-check.json");
const readCheck = async () => JSON.parse(await fs.readFile(checkFile(), "utf-8"));

test.describe("設計の分析", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("要確認を理由つきで抑制すると、design-check.json に残り、一覧から消え、ダッシュボードに件数が出る。外すと戻る", async ({ page }) => {
    // retail には、理由つきの抑制が 1 件ある (ログアウトの権限)
    await ws.gotoActive(page, "/analysis");
    await expect(page.getByTestId("an-issues-table")).toBeVisible({ timeout: 20000 });
    const rows = page.getByTestId("an-issues-table").getByRole("row");
    const before = await rows.count();
    await expect(page.getByTestId("an-suppressed-table")).toContainText("ログアウトは");

    // 商品マスタの CRUD の所見 (情報) を、期限つきで抑制する
    const target = rows.filter({ hasText: "CRUD 商品マスタ" }).first();
    const message = (await target.locator("td").nth(2).innerText()).split("\n")[0];
    await target.getByTestId("an-suppress-open").click();
    await expect(page.getByTestId("an-suppress-submit")).toBeDisabled(); // 理由が空のあいだは押せない
    await page.getByTestId("an-suppress-reason").fill("商品マスタは取り込みで登録するため");
    await page.getByTestId("an-suppress-expires").fill("2099-12-31");
    await page.getByTestId("an-suppress-submit").click();

    await expect(page.getByTestId("an-suppressed-table")).toContainText("商品マスタは取り込みで登録するため", { timeout: 15000 });
    await expect(rows).toHaveCount(before - 1);
    const saved = await readCheck();
    expect(saved.suppressions).toHaveLength(2);
    const mine = saved.suppressions.find((s: { reason: string }) => s.reason === "商品マスタは取り込みで登録するため");
    expect(mine).toMatchObject({ expiresOn: "2099-12-31", severity: "info" });
    expect(mine).toMatchObject({ section: "CRUD 商品マスタ", message });

    // 再読み込みしても、抑制は効いたまま。ダッシュボードの件数にも反映される
    await page.reload();
    await expect(page.getByTestId("an-suppressed-table")).toContainText("商品マスタは取り込みで登録するため", { timeout: 20000 });
    await ws.gotoActive(page, "/");
    await expect(page.getByTestId("design-issues-suppressed")).toContainText("抑制中 2 件", { timeout: 20000 });

    // 外すと、要確認に戻る
    await ws.gotoActive(page, "/analysis");
    const sup = page.getByTestId("an-suppressed-table").getByRole("row").filter({ hasText: "商品マスタは取り込みで登録するため" });
    await sup.getByRole("button", { name: "外す" }).click();
    await expect(rows).toHaveCount(before, { timeout: 15000 });
    expect((await readCheck()).suppressions).toHaveLength(1);
  });

  test("影響分析: テーブルを選ぶと、連鎖して影響する画面・処理・業務フローが出て、クリックで開ける", async ({ page }) => {
    await ws.gotoActive(page, "/analysis");
    await page.getByTestId("an-tab-impact").click();
    await page.getByTestId("an-impact-target").selectOption({ label: "カート (cart)" });
    const result = page.getByTestId("an-impact-result");
    await expect(result).toContainText("直接影響する");
    await expect(page.getByTestId("an-impact-level-1")).toContainText("カート追加");
    await page.getByTestId("an-impact-level-1").getByRole("button", { name: "カート追加" }).first().click();
    await expect(page).toHaveURL(/\/process-flow\/edit\/cart-add/);
  });

  test("対応表: 業務フローから画面・処理・テーブルへのトレーサビリティ表と、欠けが出る", async ({ page }) => {
    await ws.gotoActive(page, "/analysis");
    await page.getByTestId("an-tab-maps").click();
    await expect(page.getByTestId("an-trace-table")).toContainText("注文から出荷まで", { timeout: 15000 });
    await expect(page.getByTestId("an-trace-gaps")).toContainText("実現する画面も処理も決まっていません");
    await page.getByRole("button", { name: "画面項目 ↔ カラム" }).click();
    await expect(page.getByTestId("an-col-map")).toBeVisible();
  });

  test("独自ルールを足して保存すると、design-check.json に残り、要確認に違反が出る。ルールは試し打ちできる", async ({ page }) => {
    await ws.gotoActive(page, "/analysis");
    await page.getByTestId("an-tab-rules").click();
    await page.getByTestId("an-rule-add").click();
    await page.getByTestId("an-rule-name").fill("テーブルは zz_ で始める");
    await page.getByTestId("an-rule-path").fill("physicalName");
    await page.getByTestId("an-rule-check").selectOption("pattern");
    await page.getByPlaceholder("例: ^[a-z]+$").fill("^zz_");
    await expect(page.getByTestId("an-rules-preview")).toContainText("8 件の違反");
    await page.getByTestId("an-rules-save").click();
    await expect.poll(async () => (await readCheck()).rules?.length, { timeout: 15000 }).toBe(1);
    expect((await readCheck()).rules[0]).toMatchObject({ target: "table", path: "physicalName", check: { type: "pattern", pattern: "^zz_" } });
    await page.getByTestId("an-tab-issues").click();
    await expect(page.getByTestId("an-issues-table")).toContainText("ルール「テーブルは zz_ で始める」", { timeout: 15000 });
  });

  test("書き出し: テスト雛形・テストデータ・OpenAPI の案内が出る", async ({ page }) => {
    await ws.gotoActive(page, "/analysis");
    await page.getByTestId("an-tab-export").click();
    await expect(page.getByTestId("an-scaffold-count")).toContainText("ファイル");
    await expect(page.getByTestId("an-preview")).toContainText("it.todo(");
    await page.getByRole("button", { name: "テストデータ" }).click();
    await expect(page.getByTestId("an-preview")).toContainText("INSERT INTO");
    await page.getByRole("button", { name: "OpenAPI" }).click();
    await expect(page.getByTestId("an-openapi")).toBeVisible();
  });

  test("メニューの「設計の分析」から開ける。タブは 1 つだけ (再度選んでも増えない)", async ({ page }) => {
    await ws.gotoActive(page, "/");
    for (let i = 0; i < 2; i++) {
      await page.locator(".header-menu-btn").click();
      await page.locator(".header-menu-item").filter({ hasText: "設計の分析" }).click();
      await expect(page.getByTestId("design-analysis-view")).toBeVisible({ timeout: 15000 });
    }
    await expect(page).toHaveURL(/\/analysis$/);
    await expect(page.locator(".tabbar, [role=tablist]").getByText("設計の分析")).toHaveCount(1);
  });

  test("整理の「SQL」: 処理フローの SQL が一覧になり、CSV で保存できる (retail)", async ({ page }) => {
    await ws.gotoActive(page, "/analysis");
    await page.getByTestId("an-tab-cleanup").click();
    await page.getByRole("button", { name: "SQL", exact: true }).click();
    const list = page.getByTestId("an-sql-list");
    await expect(list).toBeVisible({ timeout: 20000 });
    await expect(list).toContainText("SELECT");
    await expect(list.locator("tbody tr").first()).toBeVisible();
    // CSV で保存 (ダウンロードが始まる)
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), list.getByRole("button", { name: /CSV で保存/ }).click()]);
    expect(dl.suggestedFilename()).toBe("sql.csv");
    await expect(page.getByTestId("an-sql-dups")).toBeVisible();
  });

  test("どのタブの操作部品も、読み上げに使える名前を持つ (ボタン・入力欄・表の見出し)", async ({ page }) => {
    test.setTimeout(90000);
    await ws.gotoActive(page, "/analysis");
    const problems: string[] = [];
    for (const tab of ["issues", "impact", "maps", "cleanup", "ops", "progress", "rules", "export"]) {
      await page.getByTestId(`an-tab-${tab}`).click();
      await page.waitForTimeout(400);
      // サブタブがあるものは、それぞれも見る
      const subs = await page.locator(".an-subtabs button").count();
      for (let i = 0; i < Math.max(subs, 1); i++) {
        if (subs) await page.locator(".an-subtabs button").nth(i).click();
        const bad = await page.evaluate(() => {
          const out: string[] = [];
          const visible = (el: Element) => !!(el as HTMLElement).offsetParent;
          document.querySelectorAll(".an-root button, .an-root select, .an-root input, .an-root textarea").forEach((el) => {
            if (!visible(el)) return;
            const named = el.getAttribute("aria-label") || el.getAttribute("title") || (el as HTMLElement).innerText?.trim() || el.closest("label") || (el as HTMLInputElement).placeholder;
            if (!named) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
          });
          document.querySelectorAll(".an-root th").forEach((el) => { if (visible(el) && !(el.textContent ?? "").trim()) out.push("th (空の見出し)"); });
          return out;
        });
        for (const b of new Set(bad)) problems.push(`${tab}#${i}: ${b}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
