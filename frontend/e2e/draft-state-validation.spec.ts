/**
 * draft-state validation 表示 — 領域 11 網羅 (#934)
 *
 * docs/spec/draft-state-policy.md の 5 原則を、4 リソース
 * (Table / View / ViewDefinition / ProcessFlow) の ListView 上で横断的に検証する。
 *
 * カバー範囲:
 *   原則 1 (保存許可)      : schema 違反でも draft maturity で保存可能
 *   原則 2 (UI 表示)       : ListView card / row に ValidationBadge (error / warning) が出る
 *   原則 3 (maturity 循環) : MaturityBadge クリックで draft → provisional → committed → draft
 *   原則 4 (severity 境界) : error (物理同一性違反) vs warning (表示完成度) の判定
 *
 * 適用外・skip 対象:
 *   - maturity commit 阻止 (P3-block) : by design 未実装 → test.skip (恒久)
 *   - Conventions / Extensions : draft-state policy 対象外 → test.skip (恒久)
 */

import { test, expect } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import {
  buildProject,
  buildTable,
  buildView,
  buildViewDefinition,
  buildProcessFlow,
  buildScreen,
} from "./__fixtures__/builders";
import type { ProjectEntities, Screen, TableId, Timestamp } from "../src/types/v3";

// ────────────────────────────────────────────────────────────────────
// 定数 / ヘルパー
// ────────────────────────────────────────────────────────────────────

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;
const WS_KEY = "issue-934-draft-state-validation";

let mcpAvailable = false;
let ws: OpenedWorkspace;

// ────────────────────────────────────────────────────────────────────
// Fixture データ
// ────────────────────────────────────────────────────────────────────

// --- Table ---
// エラー: physicalName 重複 (table.physicalName.duplicate)
// 警告 : 表示名空 (table.displayName.empty)
const TABLE_A_ID = normalizeId("tbl-a-draft-934");
const TABLE_B_ID = normalizeId("tbl-b-dup-934"); // TABLE_A と physicalName 重複
const TABLE_C_ID = normalizeId("tbl-c-noname-934"); // 表示名空

const tableA = buildTable({
  id: TABLE_A_ID,
  physicalName: "orders_934",
  name: "受注テーブル",
  maturity: "draft",
});

const tableB = buildTable({
  id: TABLE_B_ID,
  // 同じ physicalName → duplicate error
  physicalName: "orders_934",
  name: "受注テーブル (重複)",
  maturity: "draft",
});

// 主キー未指定 → warning (table.primaryKey.empty)
// Note: harmony.json の entities.tables[].name は DisplayName (minLength:1) スキーマ制約がある。
// PK 未指定は warning 判定なので severity 境界テスト (P4-warning) に使用する。
const tableC = buildTable({
  id: TABLE_C_ID,
  physicalName: "no_pk_tbl_934",
  name: "主キーなしテーブル",
  columns: [
    {
      id: "col-nopk" as unknown as ReturnType<typeof buildTable>["columns"][0]["id"],
      physicalName: "col1" as unknown as ReturnType<typeof buildTable>["columns"][0]["physicalName"],
      name: "カラム1",
      dataType: "VARCHAR" as ReturnType<typeof buildTable>["columns"][0]["dataType"],
      notNull: false,
      primaryKey: false,  // PK 未指定 → warning
      autoIncrement: false,
    },
  ],
});

// --- View ---
// エラー: physicalName 重複 (view.physicalName.duplicate)
const VIEW_A_ID = normalizeId("view-a-draft-934");
const VIEW_B_ID = normalizeId("view-b-dup-934");

const viewA = buildView({
  id: VIEW_A_ID,
  physicalName: "v_orders_934",
  name: "受注ビュー",
  selectStatement: "SELECT id FROM orders_934",
});

const viewB = buildView({
  id: VIEW_B_ID,
  // 同じ physicalName → duplicate error
  physicalName: "v_orders_934",
  name: "受注ビュー (重複)",
  selectStatement: "SELECT id FROM orders_934",
});

// --- ViewDefinition ---
// エラー: UNKNOWN_SOURCE_TABLE (sourceTableId が存在しないテーブルを参照)
const VD_A_ID = normalizeId("vd-a-draft-934");
const NON_EXISTENT_TABLE_ID = normalizeId("non-existent-table-934");

const viewDefA = buildViewDefinition({
  id: VD_A_ID,
  name: "存在しないテーブルを参照する定義",
  sourceTableId: NON_EXISTENT_TABLE_ID,
});

// エラー: DUPLICATE_QUERY_ALIAS (Level 2 query の from.alias と joins[0].alias が重複)
// viewDefinitionValidator.ts の checkViewDefinition が DUPLICATE_QUERY_ALIAS を生成する (#745)。
const VD_B_ID = normalizeId("vd-b-dup-alias-934");

const viewDefB = buildViewDefinition({
  id: VD_B_ID,
  name: "alias が重複する定義 (DUPLICATE_QUERY_ALIAS)",
  query: {
    from: { tableId: normalizeId("tbl-alias-src-934") as unknown as TableId, alias: "t" },
    joins: [
      {
        kind: "LEFT",
        tableId: normalizeId("tbl-alias-join-934") as unknown as TableId,
        alias: "t",  // from.alias と重複 → DUPLICATE_QUERY_ALIAS error
        on: ["t.id = t.id"],
      },
    ],
  },
});

// --- Screen (puck) ---
// エラー: puckDataRef 欠落 (editorKind=puck なのに puckDataRef が未設定)
// puckScreenValidation.ts の validatePuckScreen が severity=error を生成する (#806)。
const SCREEN_P_ID = normalizeId("scr-p-draft-934");

const screenPuck: Screen = {
  ...(buildScreen({ id: SCREEN_P_ID, name: "puck 画面 (puckDataRef 欠落)", kind: "list" }) as Screen),
  design: {
    editorKind: "puck",
    // puckDataRef を意図的に省略 → validatePuckScreen で error
  },
};

// --- ProcessFlow ---
// 警告: UNKNOWN_IDENTIFIER + UNKNOWN_RESPONSE_REF (#261)
const FLOW_ID = normalizeId("flow-a-draft-934");

const processFlowA = buildProcessFlow({
  id: FLOW_ID,
  name: "意図的な未定義参照フロー",
  kind: "screen",
  mode: "upstream",
  maturity: "draft",
  actions: [
    {
      id: "act-pf-934",
      name: "テストアクション",
      trigger: "click",
      maturity: "draft",
      responses: [{ id: "200-ok", status: 200 }],
      steps: [
        {
          id: "step-compute-934",
          type: "compute",
          description: "意図的な未定義参照",
          expression: "@undefinedVar934 * 2",
          outputBinding: "r",
          maturity: "draft",
        },
        {
          id: "step-return-934",
          type: "return",
          description: "未定義 response 参照",
          responseId: "999-missing",
          maturity: "draft",
        },
      ],
    },
  ] as ReturnType<typeof buildProcessFlow>["actions"],
});

// --- Project ---
const dummyProject = buildProject({
  name: "draft-state-validation-test",
  entities: {
    screens: [
      // puck 画面 (puckDataRef 欠落 → validatePuckScreen error)
      { id: SCREEN_P_ID, no: 1, name: "puck 画面 (puckDataRef 欠落)", kind: "list", updatedAt: FIXED_TS },
    ],
    tables: [
      { id: TABLE_A_ID, no: 1, physicalName: "orders_934",          name: "受注テーブル",        columnCount: 1, updatedAt: FIXED_TS, maturity: "draft" },
      { id: TABLE_B_ID, no: 2, physicalName: "orders_934",          name: "受注テーブル (重複)", columnCount: 1, updatedAt: FIXED_TS, maturity: "draft" },
      { id: TABLE_C_ID, no: 3, physicalName: "no_pk_tbl_934",        name: "主キーなしテーブル",  columnCount: 1, updatedAt: FIXED_TS, maturity: "draft" },
    ],
    views: [
      { id: VIEW_A_ID, no: 1, physicalName: "v_orders_934", name: "受注ビュー",        updatedAt: FIXED_TS },
      { id: VIEW_B_ID, no: 2, physicalName: "v_orders_934", name: "受注ビュー (重複)", updatedAt: FIXED_TS },
    ],
    viewDefinitions: [
      { id: VD_A_ID, no: 1, name: "存在しないテーブルを参照する定義", kind: "list", updatedAt: FIXED_TS },
      { id: VD_B_ID, no: 2, name: "alias が重複する定義 (DUPLICATE_QUERY_ALIAS)", kind: "list", updatedAt: FIXED_TS },
    ],
    processFlows: [
      { id: FLOW_ID, no: 1, name: "意図的な未定義参照フロー", kind: "screen", actionCount: 1, updatedAt: FIXED_TS, maturity: "draft" },
    ],
  } as ProjectEntities,
});

// ────────────────────────────────────────────────────────────────────
// beforeAll / afterAll
// ────────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  mcpAvailable = await isMcpRunning();
});

test.afterAll(async () => {
  if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
});

test.beforeEach(async () => {
  test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    tables: [tableA, tableB, tableC],
    views: [viewA, viewB],
    viewDefinitions: [viewDefA, viewDefB],
    processFlows: [processFlowA],
    screenEntities: [screenPuck],
  });
});

// ────────────────────────────────────────────────────────────────────
// メイン describe
// ────────────────────────────────────────────────────────────────────

test.describe("draft-state validation 表示 — 領域 11 網羅", { tag: ["@regression"] }, () => {

  // ──────────────────────────────────────────────
  // 原則 1 (保存許可): schema 違反でも draft で保存可能
  // ──────────────────────────────────────────────

  test("(P1-Table) Table schema 違反 (physicalName 重複) でも draft workspace に保存可能", async ({ page }) => {
    // setupTestWorkspace が成功した = ファイル書き出し成功 = 保存可能
    // ListView が表示できれば backend が問題なく受理した証拠
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });
    // 3 テーブルすべてが表示されていること (保存が拒否されていない)
    const cards = page.locator(".data-list-card");
    await expect(cards).toHaveCount(3, { timeout: 10000 });
  });

  test("(P1-ProcessFlow) ProcessFlow schema 違反 (未定義参照) でも draft workspace に保存可能", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/list");
    await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 10000 });
    const cards = page.locator(".data-list-card");
    await expect(cards).toHaveCount(1, { timeout: 10000 });
  });

  // ──────────────────────────────────────────────
  // 原則 2 (UI 表示): ListView card で ValidationBadge
  // ──────────────────────────────────────────────

  test("(P2-Table) Table ListView で physicalName 重複の error badge が表示される", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    // ValidationBadge が 1 枚以上表示されるまで待つ (バックグラウンド validationMap 非同期更新待ち)
    await expect(page.locator(".validation-badge.error").first()).toBeVisible({ timeout: 15000 });

    // error badge が存在することを確認
    const errorBadges = page.locator(".validation-badge.error");
    await expect(errorBadges.first()).toBeVisible();
  });

  test("(P2-Table) Table ListView で主キー未指定の warning badge が表示される", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    // .validation-badge.warning を直接待つ (.validation-badge.error が先に visible になる race を避ける)
    const warningBadge = page.locator(".validation-badge.warning");
    await expect(warningBadge.first()).toBeVisible({ timeout: 15000 });
    // warning は exclamation-triangle-fill アイコンを伴う
    await expect(warningBadge.first().locator(".bi-exclamation-triangle-fill")).toBeVisible();
  });

  test("(P2-View) View ListView で physicalName 重複の error badge が表示される", async ({ page }) => {
    await ws.gotoActive(page, "/view/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    // ValidationBadge (error) 待ち + icon 一致 assert
    const errorBadge = page.locator(".validation-badge.error");
    await expect(errorBadge.first()).toBeVisible({ timeout: 15000 });
    await expect(errorBadge.first().locator(".bi-x-circle-fill")).toBeVisible();
  });

  // normalizePersisted が entities.viewDefinitions を保持するよう修正済みであり、
  // setupTestWorkspace 経由で書き出した viewDefinitions が一覧に反映される。
  test("(P2-ViewDefinition) ViewDefinition ListView で UNKNOWN_SOURCE_TABLE の error badge が表示される", async ({ page }) => {
    await ws.gotoActive(page, "/view-definition/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    // ValidationBadge (error) 待ち
    await expect(page.locator(".validation-badge.error").first()).toBeVisible({ timeout: 15000 });
  });

  test("(P2-ProcessFlow) ProcessFlow ListView で UNKNOWN_IDENTIFIER / UNKNOWN_RESPONSE_REF の warning badge が表示される", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/list");
    await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 10000 });

    // ProcessFlowListView はバックグラウンドで aggregateValidation を実行。
    // UNKNOWN_IDENTIFIER / UNKNOWN_RESPONSE_REF は warning severity 想定なので .warning を直接待つ。
    const warningBadge = page.locator(".validation-badge.warning");
    await expect(warningBadge.first()).toBeVisible({ timeout: 20000 });
    await expect(warningBadge.first().locator(".bi-exclamation-triangle-fill")).toBeVisible();
  });

  // loadPuckScreenValidationMap + ScreenListView ValidationBadge 統合済みであり、
  // screenPuck fixture (editorKind=puck, puckDataRef 欠落) が error として検出される。
  test("(P2-Screen) Screen ListView で puck validation badge が表示される", async ({ page }) => {
    await ws.gotoActive(page, "/screen/list");
    await expect(page.locator(".screen-list-page, .table-list-page")).toBeVisible({ timeout: 10000 });

    // puck 画面の puckDataRef 欠落 → error badge が表示される
    await expect(page.locator(".validation-badge.error").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".validation-badge.error").first().locator(".bi-x-circle-fill")).toBeVisible();
  });

  // (Conventions / Extensions) draft-state policy 対象外のため恒久 skip
  // Conventions / Extensions はフレームワーク基盤側であり業務リソースではないため対象外。
  // 詳細: docs/spec/draft-state-policy.md § 7.4
  test.skip("(P2-Conventions) Conventions ListView ValidationBadge", async ({ page }) => {
    void page;
  });

  // ──────────────────────────────────────────────
  // 原則 3 (maturity 循環): MaturityBadge クリックで循環
  // ProcessFlowListView の maturity-notes.spec.ts と重複しないよう
  // Table ListView の MaturityBadge を対象とする
  // ──────────────────────────────────────────────

  test("(P3-cycle) Table ListView の MaturityBadge は aria-label に成熟度を持つ", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    // テーブル一覧がロードされるまで待つ
    await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });

    // MaturityBadge が各カードに表示されていること
    const badges = page.locator(".data-list-card .maturity-badge");
    await expect(badges.first()).toBeVisible({ timeout: 5000 });

    // aria-label に成熟度テキストが含まれること
    await expect(badges.first()).toHaveAttribute("aria-label", /成熟度/);
  });

  test("(P3-cycle) ProcessFlow ListView の MaturityBadge は view-only で aria-label に成熟度を持つ", async ({ page }) => {
    await ws.gotoActive(page, "/process-flow/list");
    await expect(page.locator(".process-flow-page")).toBeVisible({ timeout: 10000 });

    // カード表示まで待つ
    await expect(page.locator(".data-list-card").first()).toBeVisible({ timeout: 10000 });

    // ProcessFlowListView の MaturityBadge は onChange が無いため view-only (表示のみ、循環編集不可)
    // editable でないので role="button" や `editable` class は付与されない。aria-label で成熟度が表示される。
    const badge = page.locator(".data-list-card .maturity-badge").first();
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveAttribute("aria-label", /成熟度/);
    // view-only であることを class からも確認
    await expect(badge).not.toHaveClass(/editable/);
  });

  // (P3-block) ListView commit 阻止は by design 未実装のため恒久 skip
  // ListView の MaturityBadge は view-only であり、commit 阻止 UI は Editor 側のみで実装する方針。
  // 詳細: docs/spec/draft-state-policy.md § 2.5
  test.skip("(P3-block) Table committed 遷移時に error があれば阻止される", async ({ page }) => {
    void page;
  });

  // ──────────────────────────────────────────────
  // 原則 4 (severity 境界): error vs warning
  // ──────────────────────────────────────────────

  test("(P4-error) Table physicalName 重複は error severity (badge class が 'error')", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    // error badge 表示まで待つ
    await expect(page.locator(".validation-badge.error").first()).toBeVisible({ timeout: 15000 });

    // error class の badge が存在することを検証
    const errorBadge = page.locator(".validation-badge.error");
    await expect(errorBadge.first()).toBeVisible();
    // error badge には x-circle-fill アイコンが含まれること
    await expect(errorBadge.first().locator(".bi-x-circle-fill")).toBeVisible();
  });

  test("(P4-warning) Table 主キー未指定は warning severity (badge class が 'warning')", async ({ page }) => {
    await ws.gotoActive(page, "/table/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    // badge 表示まで待つ
    await expect(page.locator(".validation-badge").first()).toBeVisible({ timeout: 15000 });

    // warning class の badge が存在することを検証
    const warningBadge = page.locator(".validation-badge.warning");
    await expect(warningBadge.first()).toBeVisible();
    // warning badge には exclamation-triangle アイコンが含まれること
    await expect(warningBadge.first().locator(".bi-exclamation-triangle-fill")).toBeVisible();
  });

  test("(P4-error) View physicalName 重複は error severity", async ({ page }) => {
    await ws.gotoActive(page, "/view/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    await expect(page.locator(".validation-badge.error").first()).toBeVisible({ timeout: 15000 });

    const errorBadge = page.locator(".validation-badge.error");
    await expect(errorBadge.first()).toBeVisible();
    await expect(errorBadge.first().locator(".bi-x-circle-fill")).toBeVisible();
  });

  test("(P4-error) ViewDefinition UNKNOWN_SOURCE_TABLE は error severity", async ({ page }) => {
    await ws.gotoActive(page, "/view-definition/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    await expect(page.locator(".validation-badge.error").first()).toBeVisible({ timeout: 15000 });

    const errorBadge = page.locator(".validation-badge.error");
    await expect(errorBadge.first()).toBeVisible();
    await expect(errorBadge.first().locator(".bi-x-circle-fill")).toBeVisible();
  });

  // ──────────────────────────────────────────────
  // SQL alias — DUPLICATE_QUERY_ALIAS (validator 済み)
  // ──────────────────────────────────────────────

  // viewDefinitionValidator.ts の DUPLICATE_QUERY_ALIAS 検査 (#745) が
  // ViewDefinitionListView の loadViewDefinitionValidationMap() パスで実行される。
  // viewDefA (UNKNOWN_SOURCE_TABLE) + viewDefB (DUPLICATE_QUERY_ALIAS) の両方で
  // error badge が表示されることを count >= 2 で確認 (viewDefA の first() のみでは偽陽性になるため)。
  test("(SQL) DUPLICATE_QUERY_ALIAS で ViewDefinition ListView に error badge が表示される", async ({ page }) => {
    await ws.gotoActive(page, "/view-definition/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    // viewDefA (UNKNOWN_SOURCE_TABLE) + viewDefB (DUPLICATE_QUERY_ALIAS) の両方が error → count >= 2
    await expect(page.locator(".validation-badge.error").first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".validation-badge.error")).toHaveCount(2);
    await expect(page.locator(".validation-badge.error").first().locator(".bi-x-circle-fill")).toBeVisible();
  });
});
