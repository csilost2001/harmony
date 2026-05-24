/**
 * Entity 創成ダイアログ — kebab-case id 入力 / 衝突警告 / format validation E2E (RFC #1284 / #1297 I-5)
 *
 * 7 entity 共通 component EntityIdInput を代表 Table 創成ダイアログで smoke する。
 * (各 entity の modal 自体は実装が大体同じ inline modal なので 1 代表で動作確認)
 *
 * 現状の制約 (I-7 #1299 で解消予定):
 *   - realWorkspace の `buildProject` fixture は I-1 schema 変更 (meta.uuid required +
 *     kebab-case id) に追従していないため、`setupTestWorkspace({ project })` は
 *     "harmony.json が不正" で reject される。本 spec は `fromExample: "retail"` で
 *     回避するが、別 e2e spec でも同問題が発生中 — I-7 で fixture 統一修正予定。
 *   - workspace 切替後の entities list load タイミングが test 環境で不安定。本 spec
 *     では「テーブル追加」ボタンが toolbar に常設 (empty 状態でも出る) を利用して
 *     data load を待たずに modal を開く。collision (cart など既存 id) を使う e2e は
 *     I-7 で test infra 安定化後に追加 (component test EntityIdInput.test.tsx で網羅済)。
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

// NOTE: 本 spec は I-3 で kebab-case + meta.uuid に migration された examples/retail
// を fromExample で使う。e2e fixtures `buildProject` 系は I-7 (#1299) で
// v3 schema 互換に修正される予定 — それまでは custom seed では harmony.json
// validation で reject される。
const WS_KEY = "issue-1297-entity-id-creation";
let mcpAvailable = false;
let ws: OpenedWorkspace;

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
    // 「テーブル追加」ボタンは toolbar に常設 (empty state でも出る)。
    // データ load を待たずに直接クリックする (modal の動作確認が主目的、
    // data load の e2e は I-7 #1299 で test infra 修正後に別 spec で行う)。
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
  // realWorkspace の data load 安定化を待つ (I-7 #1299 で test infra 修正予定)。
});
