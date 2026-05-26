/**
 * Entity 創成ダイアログ — kebab-case id 入力 / 衝突警告 / format validation E2E (RFC #1284 / #1297 I-5)
 *
 * 7 entity 共通 component EntityIdInput を代表 Table 創成ダイアログで smoke する。
 * (各 entity の modal 自体は実装が大体同じ inline modal なので 1 代表で動作確認)
 *
 * I-7 #1299 完了 (2026-05-25): workspace re-render loop infra bug (Phase D で
 * 解消、root cause: useRef remount reset) + fixtures kebab-case+uuid 化 (Phase C)
 * により skip 解除済み。本 spec は `fromExample: "retail"` で安定動作する。
 *
 * collision (cart など既存 id) を使う e2e は本 spec の scope 外 (component test
 * `EntityIdInput.test.tsx` 10 ケース + `entityIdSuggestion.test.ts` 18 ケースで
 * validation / uniqueness / AI suggest / format error 等の logic は網羅済)。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

// NOTE: 本 spec は I-3 で kebab-case + meta.uuid に migration された examples/retail
// を fromExample で使う。e2e fixtures `buildProject` 系は I-7 (#1299) Phase C-3 で
// kebab-case + uuid 出力に更新済。
const WS_KEY = "issue-1297-entity-id-creation";
let mcpAvailable = false;
let ws: OpenedWorkspace;

// N-3: 同 wsId を共有するため worker 並列を回避 (serial mode)
test.describe.configure({ mode: "serial" });

test.describe("EntityIdInput — 創成ダイアログ kebab-case id 入力 (#1297 I-5)", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({
      key: WS_KEY,
      fromExample: "retail",
    });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    const addBtn = page.getByRole("button", { name: /テーブル追加/ }).first();
    await expect(addBtn).toBeVisible({ timeout: 10000 });
    await addBtn.click();
    await expect(page.locator(".tbl-modal")).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    if (mcpAvailable) await ws.resetRuntimeState(page);
  });

  test("modal に EntityIdInput / AI 提案ボタン / hint が表示される", async ({ page }) => {
    await expect(page.getByTestId("entity-id-input")).toBeVisible();
    await expect(page.getByTestId("entity-id-ai-button")).toBeVisible();
    await expect(page.locator(".entity-id-input__hint")).toContainText("kebab-case 英単語");
  });

  test("name 空のとき AI 提案ボタンは disabled", async ({ page }) => {
    const aiBtn = page.getByTestId("entity-id-ai-button");
    await expect(aiBtn).toBeDisabled();
  });

  test("表示名を入力すると AI 提案ボタンが enable になる", async ({ page }) => {
    await page.locator(".tbl-modal input").nth(1).fill("注文履歴");
    const aiBtn = page.getByTestId("entity-id-ai-button");
    await expect(aiBtn).toBeEnabled();
  });

  test("形式違反 (大文字 / underscore) を入力すると format error 表示", async ({ page }) => {
    const idInput = page.getByTestId("entity-id-input");
    await idInput.fill("Bad_ID");
    await expect(page.getByTestId("entity-id-format-error")).toBeVisible();
    await expect(idInput).toHaveClass(/is-invalid/);
  });

  test("有効な kebab-case を入力すると error が消える", async ({ page }) => {
    const idInput = page.getByTestId("entity-id-input");
    await idInput.fill("invalid_id");
    await expect(page.getByTestId("entity-id-format-error")).toBeVisible();
    await idInput.fill("order-history");
    await expect(page.getByTestId("entity-id-format-error")).not.toBeVisible();
    await expect(page.getByTestId("entity-id-unique-error")).not.toBeVisible();
  });

  test("ID 未入力時は submit ボタン disabled", async ({ page }) => {
    // 物理名 + 表示名は入れる、ID は空のまま
    await page.locator(".tbl-modal input").nth(0).fill("test_table");
    await page.locator(".tbl-modal input").nth(1).fill("テストテーブル");
    const submitBtn = page.getByRole("button", { name: /作成して編集/ });
    await expect(submitBtn).toBeDisabled();
  });

  test("全 field 有効値で submit 成功、新規 entity が edit ページに遷移", async ({ page }) => {
    await page.locator(".tbl-modal input").nth(0).fill("test_table_1297");
    await page.locator(".tbl-modal input").nth(1).fill("テストテーブル 1297");
    await page.getByTestId("entity-id-input").fill("test-table-1297");
    const submitBtn = page.getByRole("button", { name: /作成して編集/ });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();
    // submit 後は table edit に遷移する (handleAdd 内 navigate)
    await expect(page).toHaveURL(/\/w\/[^/]+\/table\/edit\/test-table-1297/);
  });

  // NOTE: uniqueness collision / 「適用」ボタンの動作確認は component test
  // (EntityIdInput.test.tsx) で網羅済。e2e で既存 entity を使った衝突テストは
  // 本 spec の scope 外 (collision UI も同 component を使うため重複検証になる)。
});
