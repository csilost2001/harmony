/**
 * 処理フローの「流れ」表示 (ISSUE #1530) の E2E。
 *
 * - 表示形式「流れ」: 見出しで区切り、判定はガード・枠で出る。条件は言葉になる
 * - 出口の一覧 (終わり方と条件の道すじ)。変数の一覧と、作る場所・使う場所の帯
 * - 確認済み ✓ は、ブラウザに残る
 * - 「カードで開く」で、編集のカード表示へ移る
 */
import { test, expect } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `process-flow-story-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("処理フローの「流れ」表示 (#1530)", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => {
    await cleanupRealWorkspaces([KEY]);
  });

  test("流れ: 見出し・ガード・言葉の条件・出口・変数・確認済み・カードで開く", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await page.getByTestId("pf-view-story").click();
    const story = page.getByTestId("process-flow-story");
    await expect(story).toBeVisible({ timeout: 15000 });

    // 見出しで区切られる (サンプルの注文確定には、4 つの見出しがある)
    await expect(page.getByTestId("pfs-section")).toHaveCount(4);
    await expect(story.getByText("入力を確かめる")).toBeVisible();

    // 「カートが空なら返す」は、ガードの 1 行。条件は言葉
    const guard = page.getByTestId("pfs-guard").first();
    await expect(guard).toBeVisible();
    await expect(guard).toContainText("422");

    // 実装の細かさで、SQL が出る
    await page.getByTestId("pfs-zoom-impl").click();
    await expect(story.getByText(/SELECT c\.id AS "cartId"/)).toBeVisible();
    await page.getByTestId("pfs-zoom-detail").click();

    // 出口: 200 を含む。クリックで流れへ戻る
    await page.getByTestId("pfs-tab-exits").click();
    const exits = page.getByTestId("pfs-exit");
    expect(await exits.count()).toBeGreaterThanOrEqual(5);
    await expect(exits.filter({ hasText: "200" })).toHaveCount(1);
    await exits.first().click();
    await expect(page.getByTestId("pfs-tab-flow")).toHaveAttribute("aria-selected", "true");

    // 変数: 「カートの明細」を選ぶと、作る場所・使う場所の帯が出る
    await page.getByTestId("pfs-tab-vars").click();
    await page.getByTestId("pfs-var-row").filter({ hasText: "カートの明細" }).first().click();
    const bar = page.getByTestId("pfs-varbar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("作る 1 か所");
    await bar.getByRole("button", { name: "解除" }).click();

    // 確認済み: 付けると進み具合が増え、再読み込みしても残る
    const progress = page.getByTestId("pfs-progress-text");
    await expect(progress).toContainText("確認済み 0 /");
    await page.getByTestId("pfs-check").first().click();
    await expect(progress).toContainText("確認済み 1 /");
    await ws.gotoActive(page, "/process-flow/edit/order-confirm");
    await expect(page.getByTestId("pfs-progress-text")).toContainText("確認済み 1 /", { timeout: 15000 });

    // カードで開く: カード表示へ移る
    await page.getByTestId("pfs-row").first().dblclick();
    await expect(page.getByTestId("pf-view-cards")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".step-card").first()).toBeVisible();
  });
});
