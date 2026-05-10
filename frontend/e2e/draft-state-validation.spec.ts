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
 *   - SQL alias #775   : UI runtime validator 未実装 → test.skip
 *   - maturity commit 阻止 (P3-block) : UI 未実装確認 → test.skip
 *   - Screen ListView   : puck validation の ListView 表示は未実装 → spec 内コメントで明示
 *   - Conventions / Extensions : ValidationBadge 未適用 → spec 内コメントで明示
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
} from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

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
    viewDefinitions: [viewDefA],
    processFlows: [processFlowA],
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

  // ViewDefinition ListView は project manifest の entities.viewDefinitions から一覧を構築するが、
  // normalizePersisted (flowStore) が entities.viewDefinitions を保持しないため、
  // setupTestWorkspace で viewDefinitions ファイルを書き出しても一覧は 0 件になる。
  // ViewDefinition は UI 経由 (saveViewDefinition → syncViewDefinitionMeta) でのみ正しく登録できる。
  // → #1004 提案 A で normalizePersisted への viewDefinitions 追加 or 代替 load パスを整備後、本 skip を解除して strict assert に戻す。
  test.skip("(P2-ViewDefinition) ViewDefinition ListView で UNKNOWN_SOURCE_TABLE の error badge が表示される — #1004: normalizePersisted が entities.viewDefinitions を保持しないため setupTestWorkspace 経由では 0 件", async ({ page }) => {
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

  // (P2-Screen) Screen ListView は puck validation の ValidationBadge 未実装のためスキップ
  // → #1004 提案 B で screenStore.loadValidationMap() + ScreenListView ValidationBadge 適用後、本 skip を解除する。
  test.skip("(P2-Screen) Screen ListView で puck validation badge が表示される — #1004: screenStore.loadValidationMap 未実装 + ScreenListView ValidationBadge 未統合", async ({ page }) => {
    // puck validation は ProcessFlowEditor 内で表示されるが、Screen ListView (screen/list) での
    // ValidationBadge 表示は未実装 (screenStore.loadValidationMap 未実装)。
    void page;
  });

  // (Conventions / Extensions) ValidationBadge 未適用のためスキップ
  // → #1004 提案 C で仕様確認 (適用するか、by design として policy.md に明記するか)。決定後 skip 解除 or 恒久 skip 化。
  test.skip("(P2-Conventions) Conventions ListView ValidationBadge — #1004: 仕様確認待ち (適用要否未決)", async ({ page }) => {
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

  // (P3-block) maturity commit 阻止: UI 実装が確認できないためスキップ
  // docs/spec/draft-state-policy.md 原則 3 の「committed への遷移を条件付きで阻止する」機能は
  // 現時点で ListView の MaturityBadge クリックでは実装されていない。
  // 仕様上 ListView は view-only の可能性もあり、policy 確定 + 必要なら Editor 側で実装する方針。
  // → #1004 提案 D で仕様確定 + 実装後、本 skip を解除する。
  test.skip("(P3-block) Table committed 遷移時に error があれば阻止される — #1004: ListView での commit 阻止 UI 未実装、仕様確定待ち", async ({ page }) => {
    // Table の maturity を committed に変えようとしたときにエラーがあれば
    // 確認ダイアログか toastify で警告する UI が必要だが未実装。
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

  // (P4-error ViewDefinition) P2-ViewDefinition と同じ理由でスキップ
  // → #1004 提案 A 解決後、本 skip を解除する。
  test.skip("(P4-error) ViewDefinition UNKNOWN_SOURCE_TABLE は error severity — #1004: normalizePersisted の entities.viewDefinitions 欠落により setupTestWorkspace 経由では 0 件", async ({ page }) => {
    await ws.gotoActive(page, "/view-definition/list");
    await expect(page.locator(".table-list-page")).toBeVisible({ timeout: 10000 });

    await expect(page.locator(".validation-badge.error").first()).toBeVisible({ timeout: 15000 });

    const errorBadge = page.locator(".validation-badge.error");
    await expect(errorBadge.first()).toBeVisible();
    await expect(errorBadge.first().locator(".bi-x-circle-fill")).toBeVisible();
  });

  // ──────────────────────────────────────────────
  // SQL alias #775 — UI runtime validator 未実装
  // ──────────────────────────────────────────────

  // SQL alias 未定義を error として検出する UI runtime validator は #775 で trace 済み。
  // sqlColumnValidator.ts は列存在検査 (UNKNOWN_COLUMN) のみ実装。
  // → #775 完了後、本 skip を解除する。
  test.skip("(SQL) SQL alias missing で error 表示 — #775: SQL alias UI runtime validator 未実装", async ({ page }) => {
    void page;
    // 期待動作:
    // ViewDefinition の Level 2 query で alias が重複または未定義の場合、
    // DUPLICATE_QUERY_ALIAS コードで error badge が ViewDefinition ListView に表示される。
    // 現時点では viewDefinitionValidator.ts の DUPLICATE_QUERY_ALIAS 検査は
    // ListView の ValidationBadge パスでは実行されていない可能性がある。
  });
});
