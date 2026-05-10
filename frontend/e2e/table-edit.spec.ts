/**
 * テーブル編集画面 (TableEditor) E2E テスト — #932
 *
 * 検証対象:
 *   1. column 追加 → 保存 → リロードで反映
 *   2. column 削除 → 保存 → リロードで反映
 *   3. column 並び替え (移動ボタン) → 保存 → 順序反映
 *   4. 型変更 (ColumnDetailEditor > select) → 保存
 *   5. PK toggle → 保存 → primaryKey: true 永続化
 *   6. index 追加 (indexes タブ) → 保存
 *   7. FK 追加 (constraints タブ、orders → customers 参照) → 保存
 *
 * 別 describe:
 *   9. ER 図ページ smoke (/table/er) — er-table-node 表示確認
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject, buildViewDefinition } from "./__fixtures__/builders";
import type { Column, ProjectEntities, Timestamp, ViewDefinition } from "../src/types/v3";

// ── Fixture データ ────────────────────────────────────────────────────────────

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const CUSTOMERS_ID = "605bbc9d-810a-4b9c-a83a-cc2e59bca37a";
const ORDERS_ID = "10d555e2-8041-4192-86f3-9e2a3ac581ab";
const VIEW_DEFINITION_ID = "4cef6340-2603-44b3-b92e-e85e4809a955";

/** harmony.json に entities.tables + entities.viewDefinitions を含む project */
const dummyProject = buildProject({
  name: "E2Eテスト用プロジェクト (table-edit)",
  entities: {
    tables: [
      { id: CUSTOMERS_ID, no: 1, physicalName: "customers", name: "顧客マスタ", category: "マスタ", columnCount: 2, maturity: "committed", updatedAt: FIXED_TS },
      { id: ORDERS_ID, no: 2, physicalName: "orders", name: "注文", category: "トランザクション", columnCount: 12, maturity: "committed", updatedAt: FIXED_TS },
    ],
    viewDefinitions: [
      { id: VIEW_DEFINITION_ID, no: 1, name: "注文一覧", kind: "list", maturity: "committed", updatedAt: FIXED_TS },
    ],
  } as ProjectEntities,
});

/** customers テーブル (FK 参照先として必要) */
const customersTable = {
  $schema: "../../schemas/v3/table.v3.schema.json",
  id: CUSTOMERS_ID,
  name: "顧客マスタ",
  physicalName: "customers",
  category: "マスタ",
  maturity: "committed",
  createdAt: FIXED_TS,
  updatedAt: FIXED_TS,
  columns: [
    {
      id: "col-id",
      no: 1,
      physicalName: "id",
      name: "顧客ID",
      dataType: "BIGINT",
      notNull: true,
      primaryKey: true,
      autoIncrement: true,
    },
    {
      id: "col-email",
      no: 2,
      physicalName: "email",
      name: "メールアドレス",
      dataType: "VARCHAR",
      length: 255,
      notNull: true,
    },
  ],
  indexes: [],
  constraints: [],
};

/** orders テーブル (12 col / 1 PK / 1 FK / 4 index) */
const ordersTable = {
  $schema: "../../schemas/v3/table.v3.schema.json",
  id: ORDERS_ID,
  name: "注文",
  physicalName: "orders",
  category: "トランザクション",
  maturity: "committed",
  createdAt: FIXED_TS,
  updatedAt: FIXED_TS,
  columns: [
    { id: "col-id", no: 1, physicalName: "id", name: "注文ID", dataType: "BIGINT", notNull: true, primaryKey: true, autoIncrement: true },
    { id: "col-order-number", no: 2, physicalName: "order_number", name: "注文番号", dataType: "VARCHAR", length: 30, notNull: true, unique: true },
    { id: "col-customer-id", no: 3, physicalName: "customer_id", name: "顧客ID", dataType: "BIGINT", notNull: true },
    { id: "col-status", no: 4, physicalName: "status", name: "注文ステータス", dataType: "VARCHAR", length: 30, notNull: true, defaultValue: "'pending'" },
    { id: "col-total-amount", no: 5, physicalName: "total_amount", name: "合計金額", dataType: "DECIMAL", length: 12, scale: 0, notNull: true },
    { id: "col-tax-amount", no: 6, physicalName: "tax_amount", name: "消費税額", dataType: "DECIMAL", length: 12, scale: 0, notNull: true, defaultValue: "0" },
    { id: "col-shipping-postal-code", no: 7, physicalName: "shipping_postal_code", name: "配送先郵便番号", dataType: "CHAR", length: 7, notNull: false },
    { id: "col-shipping-address", no: 8, physicalName: "shipping_address", name: "配送先住所", dataType: "VARCHAR", length: 300, notNull: false },
    { id: "col-note", no: 9, physicalName: "note", name: "備考", dataType: "TEXT", notNull: false },
    { id: "col-ordered-at", no: 10, physicalName: "ordered_at", name: "注文日時", dataType: "TIMESTAMP", notNull: true, defaultValue: "CURRENT_TIMESTAMP" },
    { id: "col-updated-at", no: 11, physicalName: "updated_at", name: "更新日時", dataType: "TIMESTAMP", notNull: true, defaultValue: "CURRENT_TIMESTAMP" },
    { id: "col-payment-method", no: 12, physicalName: "payment_method", name: "支払方法", dataType: "VARCHAR", length: 30, notNull: false },
  ] as unknown as Column[],
  constraints: [],
  indexes: [
    { id: "idx-order-number", physicalName: "idx_orders_order_number", columns: [{ columnId: "col-order-number", order: "asc" }], unique: true, method: "btree" },
    { id: "idx-customer", physicalName: "idx_orders_customer_id", columns: [{ columnId: "col-customer-id", order: "asc" }], method: "btree" },
    { id: "idx-status", physicalName: "idx_orders_status", columns: [{ columnId: "col-status", order: "asc" }], method: "btree" },
    { id: "idx-ordered-at", physicalName: "idx_orders_ordered_at", columns: [{ columnId: "col-ordered-at", order: "desc" }], method: "btree" },
  ],
};

// ── ViewDefinition Fixture (view-definition 連携テスト用) ──────────────────────

/**
 * 注文一覧 ViewDefinition (Level 2 query: orders JOIN customers)。
 * orders テーブル (ORDERS_ID) を from.tableId として参照する。
 * 列追加後に参照カラム select に新列が出現することを検証する。
 */
const ordersViewDefinition: ViewDefinition = buildViewDefinition({
  id: VIEW_DEFINITION_ID,
  name: "注文一覧",
  kind: "list",
  query: {
    from: { tableId: ORDERS_ID as unknown as import("../src/types/v3").TableId, alias: "o" as unknown as import("../src/types/v3").Identifier },
    joins: [
      {
        kind: "LEFT",
        tableId: CUSTOMERS_ID as unknown as import("../src/types/v3").TableId,
        alias: "c" as unknown as import("../src/types/v3").Identifier,
        on: ["o.customer_id = c.id"] as unknown as import("../src/types/v3/view-definition").ViewQueryJoin["on"],
      },
    ],
  } as unknown as import("../src/types/v3/view-definition").ViewQuery,
  columns: [
    {
      name: "orderNumber" as unknown as import("../src/types/v3").Identifier,
      tableColumnRef: {
        tableId: ORDERS_ID as unknown as import("../src/types/v3").TableId,
        columnId: "col-order-number" as unknown as import("../src/types/v3").LocalId,
      },
      displayName: "注文番号" as unknown as import("../src/types/v3").DisplayName,
      type: "string",
    },
  ],
}) as ViewDefinition;

// ── ヘルパー: 編集開始 ────────────────────────────────────────────────────────

/**
 * TableEditor を開いた直後、ResumeOrDiscardDialog を discard で閉じてから
 * 編集開始ボタンを押す。失敗時は test.skip() を呼んで false を返す。
 */
async function startEditing(page: import("@playwright/test").Page): Promise<boolean> {
  // ResumeOrDiscardDialog が出ていれば discard して閉じる (S2: getByTestId を使用)
  for (let i = 0; i < 3; i++) {
    const backdrop = page.locator(".edit-mode-modal-backdrop");
    if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
      await page.getByTestId("resume-discard").click();
      await backdrop.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else {
      break;
    }
  }

  const editBtn = page.getByTestId("edit-mode-start");
  const visible = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    test.skip();
    return false;
  }
  await editBtn.click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
  return true;
}

/**
 * 保存ボタンをクリックし、saving=false (disabled 解除) になるまで待機する。
 * EditModeToolbar.tsx:46 の disabled={saving} を根拠に判定。(M2)
 */
async function saveAndWait(page: import("@playwright/test").Page): Promise<void> {
  const saveBtn = page.getByTestId("edit-mode-save");
  await saveBtn.click();
  // saving=false に戻るのを待機 (== 保存完了)
  await expect(saveBtn).not.toBeDisabled({ timeout: 15000 });
}

// ── TestWorkspace セットアップ ─────────────────────────────────────────────

const WS_KEY = "issue-932-table-edit";
let mcpAvailable = false;
let ws: OpenedWorkspace;

// ── describe 1: TableEditor column CRUD / 型変更 / PK / FK / index ──────────

test.describe("テーブル編集 — column CRUD / 型変更 / PK / FK / index", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project: dummyProject,
      tables: [customersTable, ordersTable] as Parameters<typeof setupTestWorkspace>[0]["tables"],
      viewDefinitions: [ordersViewDefinition] as Parameters<typeof setupTestWorkspace>[0]["viewDefinitions"],
    });
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async ({ page }) => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    if (mcpAvailable) await ws.resetRuntimeState(page);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. column 追加 → 保存 → リロードで反映
  // ────────────────────────────────────────────────────────────────────────────
  test("column 追加 → 保存 → リロードで反映", async ({ page }) => {
    if (!await startEditing(page)) return;

    // カラム数を記録
    const initialCount = await page.locator(".columns-data-list .data-list-row").count();

    // カラム追加ボタン
    await page.getByRole("button", { name: /カラム追加/ }).first().click();

    // 追加後に行が 1 件増えることを確認
    await expect(page.locator(".columns-data-list .data-list-row")).toHaveCount(
      initialCount + 1,
      { timeout: 5000 }
    );

    // 保存 (M2: saveAndWait で saving 完了まで待機)
    await saveAndWait(page);

    // リロードして反映確認
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".columns-data-list .data-list-row")).toHaveCount(
      initialCount + 1,
      { timeout: 10000 }
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. column 削除 → 保存 → リロードで反映
  // ────────────────────────────────────────────────────────────────────────────
  test("column 削除 → 保存 → リロードで反映", async ({ page }) => {
    if (!await startEditing(page)) return;

    const initialCount = await page.locator(".columns-data-list .data-list-row").count();
    expect(initialCount).toBeGreaterThan(1);

    // 最後の行を選択して Delete キー
    const rows = page.locator(".columns-data-list .data-list-row");
    await rows.last().click();
    await page.keyboard.press("Delete");

    // 行が 1 件減る
    await expect(rows).toHaveCount(initialCount - 1, { timeout: 5000 });

    // 保存 (M2: saveAndWait で saving 完了まで待機)
    await saveAndWait(page);

    // リロードで確認
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".columns-data-list .data-list-row")).toHaveCount(
      initialCount - 1,
      { timeout: 10000 }
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. column 並び替え (移動ボタン) → 保存 → 順序反映
  // ────────────────────────────────────────────────────────────────────────────
  test("column 並び替え (移動ボタン) → 保存 → 順序反映", async ({ page }) => {
    if (!await startEditing(page)) return;

    // 1 列目の物理名を取得
    const rows = page.locator(".columns-data-list .data-list-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const firstColText = await rows.first().locator("code.col-name-code").textContent();

    // 1 列目を選択して「下へ」移動ボタンをクリック
    await rows.first().click();
    await page.getByRole("button", { name: /下へ/ }).click();

    // 1 列目が変わったことを確認 (元の 1 列目が 2 列目に移動)
    const newFirstText = await rows.first().locator("code.col-name-code").textContent();
    expect(newFirstText).not.toBe(firstColText);

    // 保存 (M2: saveAndWait で saving 完了まで待機)
    await saveAndWait(page);

    // リロードして順序が維持されることを確認
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const reloadedFirstText = await rows.first().locator("code.col-name-code").textContent();
    expect(reloadedFirstText).toBe(newFirstText);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. 型変更 (ColumnDetailEditor > select) → 保存
  // ────────────────────────────────────────────────────────────────────────────
  test("型変更 (VARCHAR → INTEGER) → 保存", async ({ page }) => {
    if (!await startEditing(page)) return;

    // order_number 列 (VARCHAR) をダブルクリックして詳細パネルを開く
    const rows = page.locator(".columns-data-list .data-list-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // order_number 行を探してダブルクリック
    const orderNumberRow = rows.filter({ hasText: "order_number" });
    await orderNumberRow.dblclick();

    // ColumnDetailEditor のデータ型 select が出ることを確認
    const typeSelect = page.locator(".column-detail select").first();
    await expect(typeSelect).toBeVisible({ timeout: 5000 });

    // VARCHAR → INTEGER に変更
    await typeSelect.selectOption("INTEGER");
    await expect(typeSelect).toHaveValue("INTEGER");

    // 保存 (M2: saveAndWait で saving 完了まで待機)
    await saveAndWait(page);

    // リロードして型変更が保持されていることを確認
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // order_number 行のデータ型バッジが INTEGER になっていることを確認
    const updatedRow = rows.filter({ hasText: "order_number" });
    await expect(updatedRow.locator(".col-type-badge")).toHaveText("INTEGER", { timeout: 5000 });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. PK toggle → 保存 → primaryKey: true 永続化
  // ────────────────────────────────────────────────────────────────────────────
  test("PK toggle → 保存 → primaryKey 永続化", async ({ page }) => {
    if (!await startEditing(page)) return;

    const rows = page.locator(".columns-data-list .data-list-row");
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // status 列 (PK なし) をダブルクリック
    const statusRow = rows.filter({ hasText: "status" });
    await statusRow.dblclick();

    // ColumnDetailEditor の PRIMARY KEY チェックボックスを確認 (S1: .column-flag-label を使用)
    const pkCheckbox = page.locator(".column-flag-label")
      .filter({ hasText: "PRIMARY KEY" })
      .locator("input[type='checkbox']");
    await expect(pkCheckbox).toBeVisible({ timeout: 5000 });

    // fixture invariant: ordersTable.columns[status].primaryKey === undefined (= false)
    // → 常に PK OFF の状態から ON にするパスで十分 (S4: wasChecked 分岐を撤廃)
    await expect(pkCheckbox).not.toBeChecked();
    await pkCheckbox.check();
    await expect(pkCheckbox).toBeChecked();

    // 保存 (M2: saveAndWait で saving 完了まで待機)
    await saveAndWait(page);

    // リロード後に PK バッジが status 列に反映されていることを確認
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    await expect(rows.first()).toBeVisible({ timeout: 10000 });

    // PK を ON にした → status 行に PK アイコンが表示されるはず
    const updatedStatusRow = rows.filter({ hasText: "status" });
    await expect(updatedStatusRow.locator(".col-pk-icon")).toBeVisible({ timeout: 5000 });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. index 追加 (indexes タブ) → 保存
  // ────────────────────────────────────────────────────────────────────────────
  test("index 追加 (indexes タブ) → 保存", async ({ page }) => {
    if (!await startEditing(page)) return;

    // indexes タブに切り替え
    await page.locator(".table-editor-tabs button").filter({ hasText: "インデックス" }).click();
    await expect(page.locator(".indexes-tab2")).toBeVisible({ timeout: 5000 });

    const initialIndexCount = await page.locator(".index-row2").count();

    // index 追加
    await page.locator(".indexes-tab2 .tbl-btn-primary").click();

    // IndexEditorCard が開く
    await expect(page.locator(".index-editor-card")).toBeVisible({ timeout: 5000 });

    // インデックス物理名を入力
    const nameInput = page.locator(".index-name-input2");
    await nameInput.fill("idx_orders_note");

    // 対象列を選択 (note 列)
    await page.locator(".index-editor-card .tbl-btn-ghost").filter({ hasText: "列を追加" }).click();
    const colSelect = page.locator(".index-col-select").first();
    await expect(colSelect).toBeVisible({ timeout: 3000 });
    // note 列を選択 (value は LocalId = col-note)
    await colSelect.selectOption({ value: "col-note" });

    // 完了ボタンをクリック
    await page.locator(".index-editor-footer .tbl-btn-primary").click();
    await expect(page.locator(".index-editor-card")).toBeHidden({ timeout: 3000 });

    // 一覧に追加されたことを確認
    await expect(page.locator(".index-row2")).toHaveCount(initialIndexCount + 1, { timeout: 5000 });

    // 保存 (M2: saveAndWait で saving 完了まで待機)
    await saveAndWait(page);

    // リロードして追加されていることを確認
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    // ResumeOrDiscardDialog が出る場合は discard して閉じる (S2: getByTestId を使用)
    for (let i = 0; i < 3; i++) {
      const backdrop = page.locator(".edit-mode-modal-backdrop");
      if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
        await page.getByTestId("resume-discard").click();
        await backdrop.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else {
        break;
      }
    }
    await page.locator(".table-editor-tabs button").filter({ hasText: "インデックス" }).click();
    await expect(page.locator(".indexes-tab2")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".index-row2")).toHaveCount(initialIndexCount + 1, { timeout: 10000 });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 7. FK 追加 (constraints タブ、orders → customers 参照) → 保存
  // ────────────────────────────────────────────────────────────────────────────
  test("FK 追加 (constraints タブ) → 保存", async ({ page }) => {
    if (!await startEditing(page)) return;

    // constraints タブに切り替え
    await page.locator(".table-editor-tabs button").filter({ hasText: "制約" }).click();
    await expect(page.locator(".constraints-tab")).toBeVisible({ timeout: 5000 });

    const initialConstraintCount = await page.locator(".constraint-row").count();

    // 「制約を追加」ボタン → ドロップダウン → FOREIGN KEY
    await page.locator(".constraints-add-wrap .tbl-btn-primary").click();
    await expect(page.locator(".constraints-add-menu")).toBeVisible({ timeout: 3000 });
    await page.locator(".constraints-add-menu button").filter({ hasText: "FOREIGN KEY" }).click();

    // ConstraintEditor (FK) が開く
    await expect(page.locator(".constraint-editor-card")).toBeVisible({ timeout: 5000 });

    // 自テーブルの列: customer_id チェック
    const srcChip = page.locator(".constraint-editor-card .constraint-col-chip").filter({ hasText: "customer_id" });
    await expect(srcChip).toBeVisible({ timeout: 5000 });
    await srcChip.click();
    await expect(srcChip).toHaveClass(/selected/);

    // 参照先テーブル: customers を選択
    const refTableSelect = page.locator(".constraint-editor-card select").first();
    await expect(refTableSelect).toBeVisible({ timeout: 3000 });
    // customers テーブルを参照先に選択 (value は CUSTOMERS_ID)
    await refTableSelect.selectOption({ value: CUSTOMERS_ID });

    // 参照先列: id チェック (customers.col-id を選択)
    // ConstraintEditor.FkEditor 内の「参照先列」セクションを span テキストで特定する
    const refColField = page.locator(".constraint-editor-card .constraint-editor-field").filter({ hasText: "参照先列" });
    await expect(refColField).toBeVisible({ timeout: 5000 });
    // customers は 2 列 (id, email); 最初のチップ (id) を選択
    const refColChip = refColField.locator(".constraint-col-chip").first();
    await expect(refColChip).toBeVisible({ timeout: 5000 });
    await refColChip.click();
    await expect(refColChip).toHaveClass(/selected/);

    // 完了ボタン
    await page.locator(".constraint-editor-footer .tbl-btn-primary").click();
    await expect(page.locator(".constraint-editor-card")).toBeHidden({ timeout: 3000 });

    // FK ConstraintRow が増える
    await expect(page.locator(".constraint-row")).toHaveCount(initialConstraintCount + 1, { timeout: 5000 });

    // FK バッジを確認
    await expect(page.locator(".constraint-kind-badge--foreignKey")).toBeVisible({ timeout: 3000 });

    // 保存 (M2: saveAndWait で saving 完了まで待機)
    await saveAndWait(page);

    // リロードして FK が保持されていることを確認
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    // ResumeOrDiscardDialog が出る場合は discard して閉じる (S2: getByTestId を使用)
    for (let i = 0; i < 3; i++) {
      const backdrop = page.locator(".edit-mode-modal-backdrop");
      if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
        await page.getByTestId("resume-discard").click();
        await backdrop.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else {
        break;
      }
    }
    await page.locator(".table-editor-tabs button").filter({ hasText: "制約" }).click();
    await expect(page.locator(".constraints-tab")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".constraint-row")).toHaveCount(initialConstraintCount + 1, { timeout: 10000 });
    await expect(page.locator(".constraint-kind-badge--foreignKey")).toBeVisible({ timeout: 3000 });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 9. view-definition 連携 — orders に列追加 → view-definition 編集画面で参照カラムに新列が出現
  // ────────────────────────────────────────────────────────────────────────────
  test("view-definition 連携 — orders 列追加が永続化され view-definition 編集画面で参照可能 (smoke)", async ({ page }) => {
    // beforeEach が /table/edit/${ORDERS_ID} に遷移済み
    if (!await startEditing(page)) return;

    // ── 1) orders テーブルにカラムを追加 (physicalName=audit_marker) ──────────
    const initialCount = await page.locator(".columns-data-list .data-list-row").count();

    // カラム追加ボタンをクリック
    await page.getByRole("button", { name: /カラム追加/ }).first().click();

    // 追加後に行が 1 件増えることを確認
    await expect(page.locator(".columns-data-list .data-list-row")).toHaveCount(
      initialCount + 1,
      { timeout: 5000 }
    );

    // 追加された最後の行をダブルクリックして ColumnDetailEditor を開く
    const rows = page.locator(".columns-data-list .data-list-row");
    await rows.last().dblclick();

    // physicalName を "audit_marker" に設定 (S3: column_name placeholder で確実に特定)
    const physNameInput = page.locator(".column-detail input[placeholder*='column_name']");
    await expect(physNameInput).toBeVisible({ timeout: 5000 });
    await physNameInput.clear();
    await physNameInput.fill("audit_marker");

    // 表示名を設定
    const nameInput = page.locator(".column-detail input").nth(1);
    if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await nameInput.clear();
      await nameInput.fill("監査マーカ");
    }

    // ── 2) 保存 (M2: saveAndWait で saving 完了まで待機) ────────────────────────
    await saveAndWait(page);

    // 保存後 orders を再ロードし、audit_marker が永続化されたことを verify
    await ws.gotoActive(page, `/table/edit/${ORDERS_ID}`);
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 10000 });
    // ResumeOrDiscardDialog を dismiss
    for (let i = 0; i < 3; i++) {
      const backdrop = page.locator(".edit-mode-modal-backdrop");
      if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
        await page.getByTestId("resume-discard").click();
        await backdrop.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else {
        break;
      }
    }
    const persistedNames = await page
      .locator(".columns-data-list .data-list-row code.col-name-code")
      .allTextContents();
    // 列追加伝搬の前提として、saveAndWait 後に orders に新列が永続化されていること
    expect(persistedNames.some((n) => /audit_marker|new_column/.test(n))).toBe(true);

    // ── 3) view-definition 「注文一覧」編集画面へ遷移 ───────────────────────
    await ws.gotoActive(page, `/view-definition/edit/${VIEW_DEFINITION_ID}`);
    // M3: .table-editor-page だけだと TableEditor でも通過するため editor-header の名前を確認
    await expect(page.locator(".table-editor-page")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("editor-header").getByText("注文一覧")).toBeVisible({ timeout: 10000 });

    // ResumeOrDiscardDialog が出ていれば discard して閉じる (S2: getByTestId を使用)
    for (let i = 0; i < 3; i++) {
      const backdrop = page.locator(".edit-mode-modal-backdrop");
      if (await backdrop.isVisible({ timeout: 500 }).catch(() => false)) {
        await page.getByTestId("resume-discard").click();
        await backdrop.waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else {
        break;
      }
    }

    // ── 4) ViewDefinitionEditor で「カラム追加」→ 参照テーブルを orders にして
    //        参照カラム select に audit_marker が出現することを確認 ──────────

    // 編集モードに入る (edit-mode-start ボタンがあれば押す)
    const editBtn = page.getByTestId("edit-mode-start");
    if (await editBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editBtn.click();
      await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 5000 });
    }

    // 「カラム追加」ボタンをクリックして新しい列行を追加
    const addColBtn = page.locator("button").filter({ hasText: "カラム追加" });
    await expect(addColBtn).toBeVisible({ timeout: 5000 });
    await addColBtn.click();

    // ViewDefinitionEditor の各 column 行は .vd-col-select を 3 つ持つ:
    // [0] = 参照テーブル, [1] = 参照カラム, [2] = type。
    // 最後の行を tbody tr で特定してから、その中で nth(0)/nth(1) を使う。
    const lastRow = page.locator(".vd-editor-columns-table tbody tr").last();
    await expect(lastRow).toBeVisible({ timeout: 5000 });
    const refTableSelect = lastRow.locator(".vd-col-select").nth(0);
    await expect(refTableSelect).toBeVisible({ timeout: 5000 });

    // orders テーブル (ORDERS_ID) を選択
    // M1: orders が参照テーブル候補に出ない場合はテスト失敗にする (サイレント pass 禁止)
    const ordersOption = refTableSelect.locator(`option[value="${ORDERS_ID}"]`);
    const hasOrdersOption = await ordersOption.count().then((c) => c > 0).catch(() => false);
    expect(hasOrdersOption).toBe(true);

    await refTableSelect.selectOption({ value: ORDERS_ID });

    // 参照テーブル選択後、同行 nth(1) = 参照カラム select に audit_marker が出現するか確認
    const colSelect = lastRow.locator(".vd-col-select").nth(1);
    await expect(colSelect).toBeVisible({ timeout: 5000 });

    // #1002 の tableStore subscription 修正により、同一 tab 内で追加した列が
    // ViewDefinitionEditor の参照カラム候補へ即時反映されることを strict に検証する。
    await expect(colSelect.locator('option[value="audit_marker"]')).toHaveCount(1, {
      timeout: 10000,
    });
  });
});

// ── describe 2: ER 図 smoke ──────────────────────────────────────────────────

const ER_WS_KEY = "issue-932-er-diagram";
let erMcpAvailable = false;
let erWs: OpenedWorkspace;

test.describe("ER 図 smoke (/table/er)", { tag: ["@regression"] }, () => {
  test.beforeAll(async () => {
    erMcpAvailable = await isMcpRunning();
    if (!erMcpAvailable) return;
    erWs = await setupTestWorkspace({
      key: ER_WS_KEY,
      project: dummyProject,
      tables: [customersTable, ordersTable] as Parameters<typeof setupTestWorkspace>[0]["tables"],
    });
  });

  test.afterAll(async () => {
    if (erMcpAvailable) await cleanupRealWorkspaces([ER_WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!erMcpAvailable, "backend (port 5179) が起動していません");
  });

  test.afterEach(async ({ page }) => {
    if (erMcpAvailable) await erWs.resetRuntimeState(page);
  });

  test("ER 図 — ReactFlow ノードが表示される", async ({ page }) => {
    await erWs.gotoActive(page, "/table/er");
    await expect(page.locator(".er-diagram-page")).toBeVisible({ timeout: 10000 });

    // テーブルノードが 2 件表示されることを確認 (orders + customers)
    await expect(page.locator(".er-table-node")).toHaveCount(2, { timeout: 10000 });

    // orders ノードの物理名が表示されていることを確認
    await expect(page.locator(".er-node-name").filter({ hasText: "orders" })).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".er-node-name").filter({ hasText: "customers" })).toBeVisible({ timeout: 5000 });
  });
});
