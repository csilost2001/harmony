/**
 * 連携と運用 (第 5 弾): 設計書の Word / Excel・体裁と改訂履歴・図の書き出し・レビューと承認・権限・変更の記録・Git・通知・取り込み・生成の管理・技術スタックのプリセット・版。
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { buildXlsx, canonicalForHash, readZip } from "@harmony/shared";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `integration-ops-${Date.now()}`;
let ws: OpenedWorkspace;
const dataFile = (name: string) => path.join(ws.workspacePath, "harmony", name);
const opsFile = (name: string) => path.join(ws.workspacePath, ".harmony-ops", name);
const readJson = async (p: string) => JSON.parse(await fs.readFile(p, "utf-8"));
const inflate = async (b: Uint8Array) => new Uint8Array(zlib.inflateRawSync(b));
const asUser = async (page: Page, name: string) => { await page.addInitScript((n) => { try { localStorage.setItem("harmony.userName", n); } catch { /* 保存できない環境 */ } }, name); };
/** ファイルがまだ無いあいだは null (保存の完了を、expect.poll で待つ) */
const tryJson = async (p: string) => { try { return await readJson(p); } catch { return null; } };
const rm = (p: string) => fs.rm(p, { force: true, recursive: true });

test.describe("連携と運用", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => {
    await ws?.resetRuntimeState();
    for (const f of ["access.json", "approvals.json", "review-comments.json", "document-template.json", "generation.json"]) await rm(dataFile(f));
    await rm(path.join(ws.workspacePath, ".harmony-ops"));
  });

  test("設計書を Word (.docx) と Excel (.xlsx) で保存できる。docx は設計書の本文を、xlsx は章ごとのシートを持つ", async ({ page }) => {
    await ws.gotoActive(page, "/document");
    await expect(page.getByTestId("ddv-save-docx")).toBeEnabled({ timeout: 30000 });
    const [docx] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ddv-save-docx").click()]);
    expect(docx.suggestedFilename()).toMatch(/design-document\.docx$/);
    const dz = await readZip(new Uint8Array(await fs.readFile((await docx.path())!)), inflate);
    const body = new TextDecoder().decode(dz.get("word/document.xml")!);
    expect(body).toContain("1. 画面一覧");
    expect(body).toContain("<w:tbl>");
    expect([...dz.keys()]).toEqual(expect.arrayContaining(["[Content_Types].xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml"]));

    const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ddv-save-xlsx").click()]);
    expect(xlsx.suggestedFilename()).toMatch(/design-document\.xlsx$/);
    const xz = await readZip(new Uint8Array(await fs.readFile((await xlsx.path())!)), inflate);
    const wb = new TextDecoder().decode(xz.get("xl/workbook.xml")!);
    const names = [...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain("1. 画面一覧");
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });

  test("体裁と改訂履歴: 文書名・載せない章・改訂履歴を保存すると、設計書 (画面・Word) に反映され、ファイルに残る。更新から下書きも作れる", async ({ page }) => {
    await ws.gotoActive(page, "/document");
    await expect(page.getByTestId("ddv-template")).toBeEnabled({ timeout: 30000 });
    await expect(page.locator(".hd-doc")).toContainText("基本設計書・処理設計書");
    await expect(page.locator(".hd-doc #crud")).toHaveCount(1);
    await page.getByTestId("ddv-template").click();
    await page.getByTestId("dt-documentTitle").fill("要件定義書 (試験)");
    await page.getByTestId("dt-docNumber").fill("DD-2026-014");
    await page.getByTestId("dt-tab-chapters").click();
    await page.getByTestId("dt-chapter-crud").uncheck();
    await page.getByTestId("dt-tab-revisions").click();
    await page.getByTestId("dt-rev-add").click();
    await expect(page.getByTestId("dt-save")).toBeDisabled(); // 内容が空のあいだは保存できない
    await page.getByTestId("dt-rev-row").first().getByLabel("内容").fill("初版");
    await page.getByTestId("dt-save").click();
    await expect(page.getByTestId("doc-template-dialog")).toHaveCount(0);

    // 画面に反映: 文書名・改訂履歴・章 (CRUD 図は載らない)
    await expect(page.locator(".hd-doc")).toContainText("要件定義書 (試験)", { timeout: 15000 });
    await expect(page.locator(".hd-doc #revisions")).toContainText("初版");
    await expect(page.locator(".hd-doc #crud")).toHaveCount(0);
    const chapters = await page.locator(".hd-doc > .hd-section.hd-level-1 .hd-chapter").allInnerTexts();
    const nums = chapters.filter((c) => /^\d+$/.test(c)).map(Number);
    expect(nums).toEqual(nums.map((_, i) => i + 1)); // 章番号が詰まっている
    const saved = await readJson(dataFile("document-template.json"));
    expect(saved).toMatchObject({ documentTitle: "要件定義書 (試験)", docNumber: "DD-2026-014", excludeChapters: ["crud"] });
    expect(saved.revisions).toHaveLength(1);

    // Word にも、改訂履歴と文書名が載る
    const [docx] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ddv-save-docx").click()]);
    const body = new TextDecoder().decode((await readZip(new Uint8Array(await fs.readFile((await docx.path())!)), inflate)).get("word/document.xml")!);
    expect(body).toContain("要件定義書 (試験)");
    expect(body).toContain("改訂履歴");
    expect(body).toContain("初版");

    // 保存前の版がある設計が、改訂履歴の下書きに拾われる (取り込んだ直後の retail は、保存履歴がないので、空のことがある)
    await page.getByTestId("ddv-template").click();
    await page.getByTestId("dt-tab-revisions").click();
    await page.getByTestId("dt-rev-suggest").click();
    await expect(page.getByTestId("dt-rev-row").first()).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("図の書き出し: ER 図は Mermaid / PlantUML、処理フローは SVG もある。コピーと保存ができる", async ({ page }) => {
    await ws.gotoActive(page, "/analysis");
    await page.getByTestId("an-tab-export").click();
    await page.getByRole("button", { name: /^図/ }).click();
    const preview = page.getByTestId("an-diagram-preview");
    await expect(preview).toContainText("erDiagram");
    await expect(preview).toContainText("||--o{");
    await page.getByTestId("an-diagram-format-plantuml").check();
    await expect(preview).toContainText("@startuml");
    await expect(page.getByTestId("an-diagram-format-svg")).toBeDisabled(); // ER 図の SVG は無い
    await page.getByTestId("an-diagram-target").selectOption({ label: "処理フロー図: カート追加" });
    await page.getByTestId("an-diagram-format-svg").check();
    await expect(preview.locator("img")).toBeVisible();
    await expect(preview).toContainText("<svg");
    const [file] = await Promise.all([page.waitForEvent("download"), page.getByTestId("an-diagram-save").click()]);
    expect(file.suggestedFilename()).toMatch(/^processFlow-cart-add\.svg$/);
    await page.getByTestId("an-diagram-target").selectOption({ index: 1 });
    await page.getByTestId("an-diagram-format-mermaid").check();
    await expect(preview).toContainText("flowchart LR");
  });

  test("レビュー: 各設計のヘッダーからコメントを書くと、未解決の数が印に出て、「連携と運用」にも出る。解決済みにするとファイルにも残る", async ({ page }) => {
    await asUser(page, "花子");
    await ws.gotoActive(page, "/table/edit/cart");
    await page.getByTestId("review-open").click();
    const panel = page.getByTestId("review-panel");
    await expect(panel).toContainText("この設計へのコメントは、まだありません");
    await expect(page.getByTestId("op-thread-send")).toBeDisabled();
    await page.getByTestId("op-thread-path").fill("columns[0]");
    await page.getByTestId("op-thread-text").fill("桁数を確認してください");
    await page.getByTestId("op-thread-send").click();
    await expect(panel.getByTestId("op-thread")).toContainText("桁数を確認してください");
    await expect(page.getByTestId("review-badge")).toHaveText("1");
    const file = await readJson(dataFile("review-comments.json"));
    expect(file.threads[0]).toMatchObject({ target: { kind: "table", id: "cart", path: "columns[0]" }, status: "open" });
    expect(file.threads[0].messages[0]).toMatchObject({ by: "花子", text: "桁数を確認してください" });

    await ws.gotoActive(page, "/operations");
    await expect(page.getByTestId("op-comments")).toContainText("桁数を確認してください", { timeout: 15000 });
    await page.getByTestId("op-reply-input").fill("20 桁にします");
    await page.getByTestId("op-reply-send").click();
    await expect(page.getByTestId("op-comments")).toContainText("20 桁にします");
    await page.getByTestId("op-thread-resolve").click();
    await expect(page.getByTestId("op-comments")).toContainText("未解決のコメントはありません");
    await expect.poll(async () => (await tryJson(dataFile("review-comments.json")))?.threads[0]?.status).toBe("resolved");
    await page.getByTestId("op-thread-filter").selectOption("resolved");
    await expect(page.getByTestId("op-thread")).toContainText("解決済み");
  });

  test("承認と権限: 役割を登録すると、閲覧の人は依頼できず、編集の人は承認できない。承認の人が承認すると記録に残り、内容が変わると「承認後に変更」になる", async ({ page }) => {
    // 権限の設定 (画面から)。最初の設定では、あなたを「管理」にする
    await asUser(page, "管理者");
    await ws.gotoActive(page, "/operations");
    await page.getByTestId("op-tab-access").click();
    await expect(page.getByTestId("op-access-you")).toContainText("制限なし");
    await page.getByTestId("op-access-add").click();
    await page.getByTestId("op-access-table").getByLabel("利用者名").first().fill("管理者");
    for (const [name, role] of [["編集者", "editor"], ["承認者", "approver"], ["閲覧者", "viewer"]] as const) {
      await page.getByTestId("op-access-add").click();
      const rows = page.getByTestId("op-access-table").locator("tbody tr");
      const row = rows.last();
      await row.getByLabel("利用者名").fill(name);
      await row.getByLabel("役割").selectOption(role);
    }
    await page.getByTestId("op-access-save").click();
    await expect.poll(async () => (await tryJson(dataFile("access.json")))?.users.length).toBe(4);
    await expect(page.getByTestId("op-access-you")).toContainText("管理");
    await page.getByTestId("op-tab-review").click(); // 開くタブは、このブラウザに覚えられる (次に開く画面は「レビューと承認」から)

    // 閲覧者: 承認の依頼は、できない (サーバが日本語の理由で断る)
    const asViewer = await page.context().newPage();
    await asUser(asViewer, "閲覧者");
    await ws.gotoActive(asViewer, "/operations");
    await asViewer.getByTestId("op-request-kind").selectOption("table");
    await asViewer.getByTestId("op-request-id").selectOption({ label: "カート" });
    await asViewer.getByTestId("op-approval-review").click();
    await expect(asViewer.locator(".toast-host")).toContainText("「編集」以上の役割が必要です", { timeout: 15000 });
    await asViewer.close();

    // 編集者: 依頼はできるが、承認はできない
    const asEditor = await page.context().newPage();
    await asUser(asEditor, "編集者");
    await ws.gotoActive(asEditor, "/operations");
    await asEditor.getByTestId("op-request-kind").selectOption("table");
    await asEditor.getByTestId("op-request-id").selectOption({ label: "カート" });
    await asEditor.getByTestId("op-approval-review").click();
    await expect(asEditor.getByTestId("op-approval-table")).toContainText("承認待ち", { timeout: 15000 });
    await asEditor.getByTestId("op-approval-table").getByTestId("op-approval-approved").click();
    await expect(asEditor.locator("body")).toContainText("「承認」以上の役割が必要です", { timeout: 15000 });
    await asEditor.close();

    // 承認者: 承認できる。内容の印が残り、履歴に承認者の名前が残る
    const asApprover = await page.context().newPage();
    await asUser(asApprover, "承認者");
    await ws.gotoActive(asApprover, "/operations");
    await asApprover.getByTestId("op-approval-table").getByTestId("op-approval-approved").click();
    await expect(asApprover.getByTestId("op-approval-table")).toContainText("承認済み", { timeout: 15000 });
    const approvals = await readJson(dataFile("approvals.json"));
    expect(approvals.items[0]).toMatchObject({ kind: "table", id: "cart", state: "approved" });
    expect(approvals.items[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(approvals.items[0].history.map((h: { state: string; by: string }) => [h.state, h.by])).toEqual([["review", "編集者"], ["approved", "承認者"]]);

    // 設計を変えると「承認後に変更」になる
    const cartFile = dataFile("tables/cart.json");
    const cart = await readJson(cartFile);
    await fs.writeFile(cartFile, JSON.stringify({ ...cart, comment: `${cart.comment ?? ""}(変更)` }, null, 2));
    await asApprover.reload();
    await expect(asApprover.getByTestId("op-approval-table")).toContainText("承認後に変更", { timeout: 20000 });
    await asApprover.close();

    // 変更の記録に、承認の操作が、利用者名つきで残る
    await asUser(page, "管理者");
    await ws.gotoActive(page, "/operations");
    await page.getByTestId("op-tab-audit").click();
    await expect(page.getByTestId("op-audit-table")).toContainText("承認の状態を「承認済み」にした", { timeout: 15000 });
    await expect(page.getByTestId("op-audit-table")).toContainText("承認者");
    await page.getByTestId("op-audit-actor").selectOption("承認者");
    await expect(page.getByTestId("op-audit-table").locator("tbody tr")).toHaveCount(1);
    await page.getByTestId("op-audit-q").fill("該当なしの語");
    await expect(page.getByTestId("op-audit-count")).toContainText("0 件");
  });

  test("方針「確定には承認を必須にする」: 承認のない確定の保存は止まり、要確認にも出る", async ({ page }) => {
    await fs.writeFile(dataFile("access.json"), JSON.stringify({ version: 1, users: [{ name: "管理者", role: "admin" }], policy: { requireApprovalForCommitted: true } }));
    await asUser(page, "管理者");
    await ws.gotoActive(page, "/analysis");
    // retail の確定 (committed) の設計は、承認がないので、警告が出る
    await expect(page.getByTestId("an-issues-table")).toContainText("確定 (committed) ですが、承認されていません", { timeout: 30000 });
  });

  test("変更の記録・通知: 通知先は URL を画面に出さず、.harmony-ops/ (git に載らない) にだけ保存する。http や社内のアドレスは登録できない", async ({ page }) => {
    await asUser(page, "管理者");
    await ws.gotoActive(page, "/operations");
    await page.getByTestId("op-tab-notify").click();
    await page.getByTestId("op-hook-add").click();
    await page.getByTestId("op-hook-name").fill("設計チーム");
    await page.getByTestId("op-hook-url").fill("http://hooks.example.com/secret-token");
    await expect(page.getByTestId("op-notify")).toContainText("https:// の URL だけ使えます");
    await expect(page.getByTestId("op-notify-save")).toBeDisabled();
    await page.getByTestId("op-hook-url").fill("https://localhost/x");
    await expect(page.getByTestId("op-notify")).toContainText("社内・ローカルのホストへは送れません");
    await page.getByTestId("op-hook-url").fill("https://hooks.invalid/services/SECRET-TOKEN");
    await page.getByTestId("op-hook-event-issues").check();
    await page.getByTestId("op-notify-save").click();
    await expect.poll(async () => (await tryJson(opsFile("notify.json")))?.webhooks.length).toBe(1);
    expect(await fs.readFile(path.join(ws.workspacePath, ".harmony-ops", ".gitignore"), "utf-8")).toBe("*\n");
    // 保存したあと、URL は画面に出ない (ホスト名だけ)
    await expect(page.getByTestId("op-hook")).toContainText("hooks.invalid");
    await expect(page.locator("body")).not.toContainText("SECRET-TOKEN");
    // テスト送信は、確認のあとだけ。.invalid は名前を解決できないので、失敗が通知される (外へは出ない)
    await page.getByTestId("op-hook-test").click();
    await expect(page.getByTestId("op-hook")).toContainText("実際に外部へ送ります");
    await page.getByTestId("op-hook-test-go").click();
    await expect(page.locator("body")).toContainText("送れませんでした", { timeout: 15000 });
  });

  test("Git: リポジトリにして、変更を確認し、選んだファイルだけコミットする。履歴に出る", async ({ page }) => {
    await asUser(page, "管理者");
    await ws.gotoActive(page, "/operations");
    await page.getByTestId("op-tab-git").click();
    await expect(page.getByTestId("op-git-norepo")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("op-git-init").click();
    await page.getByTestId("op-git-init-go").click();
    await expect(page.getByTestId("op-git-files")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("op-git-file").first()).toBeVisible();
    await expect(page.getByTestId("op-git-commit")).toBeDisabled();
    const row = page.getByTestId("op-git-file").filter({ hasText: "harmony.json" }).first();
    await row.getByRole("checkbox").check();
    await row.getByRole("button", { name: "差分" }).click();
    await expect(page.getByTestId("op-git-diff")).toContainText("+++ b/harmony.json");
    await page.getByTestId("op-git-message").fill("最初のコミット (試験)");
    await page.getByTestId("op-git-commit").click();
    await expect(page.getByTestId("op-git-log")).toContainText("最初のコミット (試験)", { timeout: 15000 });
    await expect(page.getByTestId("op-git-files")).not.toContainText("harmony.json");
    // ブランチは、変更が残っているあいだは切り替えられない
    await expect(page.getByTestId("op-git-switch")).toBeDisabled();
  });

  test("取り込み: DDL からテーブルを作る (予行 → 選んで取り込む)。同じ id は作らない。OpenAPI から処理フローの骨組みを作る", async ({ page }) => {
    await ws.gotoActive(page, "/operations");
    await page.getByTestId("op-tab-import").click();
    const ddl = `
CREATE TABLE public.shipments (
  id bigint PRIMARY KEY,
  order_no varchar(20) NOT NULL,
  carrier uuid,
  shipped_at timestamp DEFAULT now()
);
COMMENT ON TABLE public.shipments IS '出荷';
CREATE INDEX idx_shipments_order ON public.shipments (order_no);
CREATE TABLE cart (id int);
CREATE TRIGGER t BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION f();`;
    await page.getByTestId("op-ddl-text").fill(ddl);
    const rows = page.getByTestId("op-ddl-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "shipments" })).toContainText("新規に作る");
    await expect(rows.filter({ hasText: "cart" })).toContainText("既にあるため、作りません");
    await expect(page.getByTestId("op-ddl-warnings")).toContainText("uuid");
    await expect(page.getByTestId("op-ddl-skipped")).toContainText("CREATE TRIGGER");
    await page.getByTestId("op-ddl-apply").click();
    await expect.poll(async () => fs.access(dataFile("tables/shipments.json")).then(() => true, () => false)).toBe(true);
    const t = await readJson(dataFile("tables/shipments.json"));
    expect(t).toMatchObject({ id: "shipments", physicalName: "shipments", name: "出荷", maturity: "draft" });
    expect(t.columns.map((c: { physicalName: string; dataType: string }) => [c.physicalName, c.dataType])).toEqual([["id", "BIGINT"], ["order_no", "VARCHAR"], ["carrier", "VARCHAR"], ["shipped_at", "TIMESTAMP"]]);
    expect(t.indexes).toHaveLength(1);
    expect(t.uuid).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.locator(".toast-host")).toContainText("1 件のテーブルを取り込みました");
    await expect(page.getByTestId("op-ddl-text")).toHaveValue(""); // 取り込みが終わると、入力欄は空に戻る
    // 取り込んだあとは、同じ DDL の shipments も「既にある」
    await page.getByTestId("op-ddl-text").fill(ddl);
    await expect(page.getByTestId("op-ddl-row").filter({ hasText: "shipments" })).toContainText("既にあるため、作りません");

    const spec = { openapi: "3.0.3", info: { title: "出荷 API" }, paths: { "/shipments/{id}": { get: { operationId: "getShipment", summary: "出荷の取得", responses: { "200": { description: "成功" }, "404": { description: "なし" } } } }, "/shipments": { post: { operationId: "createShipment", summary: "出荷の登録", requestBody: { content: { "application/json": { schema: { type: "object", required: ["orderNo"], properties: { orderNo: { type: "string" } } } } } }, responses: { "201": { description: "作成" } } } } } };
    await page.getByTestId("op-openapi-text").fill(JSON.stringify(spec));
    await expect(page.getByTestId("op-openapi-row")).toHaveCount(2);
    await page.getByTestId("op-openapi-apply").click();
    await expect(page.locator(".toast-host")).toContainText("2 件の処理フローの骨組みを作りました");
    await expect.poll(async () => fs.access(dataFile("process-flows/get-shipment.json")).then(() => true, () => false)).toBe(true);
    const f = await readJson(dataFile("process-flows/create-shipment.json"));
    expect(f.actions[0].httpRoute).toMatchObject({ method: "POST", path: "/shipments" });
    expect(f.actions[0].inputs).toEqual([{ name: "orderNo", type: "string", required: true }]);
    expect(f.actions[0].responses[0]).toMatchObject({ id: "201-created", status: 201 });
    expect(f.meta).toMatchObject({ id: "create-shipment", name: "出荷の登録", flowType: "common" });
    // 取り込んだ処理フローは、一覧にも出る
    await ws.gotoActive(page, "/process-flow/list");
    await expect(page.getByText("出荷の登録").first()).toBeVisible({ timeout: 15000 });
  });

  test("Excel の表を、カラムの貼り付けで読み込める (予行に出る)", async ({ page }) => {
    const xlsx = buildXlsx([{ name: "カラム", rows: [{ cells: ["物理名", "表示名", "データ型", "長さ"], style: 1 }, { cells: ["ship_to", "出荷先", "VARCHAR", "100"] }, { cells: ["ship_qty", "出荷数", "INTEGER", ""] }] }]);
    await ws.gotoActive(page, "/table/edit/cart");
    await page.getByTestId("edit-mode-start").click();
    await expect(page.getByTestId("paste-columns-open")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("paste-columns-open").click();
    await page.getByTestId("excel-file-input").setInputFiles({ name: "columns.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(xlsx) });
    await expect(page.getByTestId("paste-columns-text")).toHaveValue(/ship_to\t出荷先\tVARCHAR\t100/, { timeout: 15000 });
    await expect(page.getByTestId("paste-columns-dialog")).toContainText("ship_qty");
    await page.keyboard.press("Escape");
  });

  test("生成の管理: 記録と突き合わせて、設計が変わったもの・生成物が書き換えられたものを示し、設計の差分を見られる", async ({ page }) => {
    // AI が designer__record_generation で残す記録と同じ形のファイルを用意する (印は、サーバと同じ計算)
    const cartPath = dataFile("tables/cart.json");
    const cart = await readJson(cartPath);
    const hashOf = (j: unknown) => crypto.createHash("sha256").update(canonicalForHash(j)).digest("hex");
    const code = "export const cart = 1;\n";
    await fs.mkdir(path.join(ws.workspacePath, "generated"), { recursive: true });
    await fs.writeFile(path.join(ws.workspacePath, "generated", "cart.ts"), code);
    await fs.writeFile(path.join(ws.workspacePath, "generated", "gone.ts"), code);
    const hash = hashOf(cart);
    await fs.mkdir(path.join(ws.workspacePath, ".harmony-ops", "gen-snapshots"), { recursive: true });
    await fs.writeFile(path.join(ws.workspacePath, ".harmony-ops", "gen-snapshots", `table-cart-${hash.slice(0, 16)}.json`), JSON.stringify(cart));
    const outHash = crypto.createHash("sha256").update(code).digest("hex");
    const at = new Date().toISOString();
    await fs.writeFile(dataFile("generation.json"), JSON.stringify({ version: 1, outputs: [
      { path: "generated/cart.ts", sources: [{ kind: "table", id: "cart", hash }], outputHash: outHash, at, generator: "generate-code" },
      { path: "generated/gone.ts", sources: [{ kind: "table", id: "cart", hash }], outputHash: outHash, at },
    ] }));
    await ws.gotoActive(page, "/operations");
    await page.getByTestId("op-tab-generation").click();
    const rows = page.getByTestId("op-generation-table").locator("tbody tr");
    await expect(rows).toHaveCount(2, { timeout: 15000 });
    await expect(page.getByTestId("op-generation-summary")).toContainText("すべて最新です");
    // 設計を変える → 再生成が必要。生成物を消す → 生成物がない
    await fs.writeFile(cartPath, JSON.stringify({ ...cart, comment: "配送先を追加した" }, null, 2));
    await fs.rm(path.join(ws.workspacePath, "generated", "gone.ts"));
    await page.reload();
    await expect(rows.filter({ hasText: "generated/cart.ts" }).getByTestId("op-drift-state")).toHaveAttribute("data-state", "design-changed", { timeout: 20000 });
    await expect(rows.filter({ hasText: "generated/gone.ts" }).getByTestId("op-drift-state")).toHaveAttribute("data-state", "output-missing");
    await expect(page.getByTestId("op-generation-summary")).toContainText("2 件が、確認を要します");
    await rows.filter({ hasText: "generated/cart.ts" }).getByTestId("op-drift-diff").click();
    await expect(page.getByTestId("op-drift-diff-view")).toContainText("comment", { timeout: 15000 });
    await expect(page.getByTestId("op-drift-diff-view")).toContainText("配送先を追加した");
    // 生成物も書き換える → 両方が変わった
    await fs.mkdir(path.join(ws.workspacePath, "generated"), { recursive: true });
    await fs.writeFile(path.join(ws.workspacePath, "generated", "cart.ts"), "// 手で直した\n");
    await page.reload();
    await expect(rows.filter({ hasText: "generated/cart.ts" }).getByTestId("op-drift-state")).toHaveAttribute("data-state", "both-changed", { timeout: 20000 });
    await fs.writeFile(cartPath, JSON.stringify(cart, null, 2)); // 後始末 (他の試験のために、設計を戻す)
    await fs.rm(path.join(ws.workspacePath, "generated"), { recursive: true, force: true });
  });

  test("技術スタックのプリセット: 選ぶとまとめて入り、保存するまで確定しない。保存すると harmony.json に残る", async ({ page }) => {
    await ws.gotoActive(page, "/project/tech-stack");
    await expect(page.getByTestId("techstack-preset-select")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("techstack-preset-select").selectOption({ label: "Go (Gin + PostgreSQL) + Kubernetes" });
    await expect(page.getByText("FW: gin")).toBeVisible();
    await expect(page.getByText("ターゲット: kubernetes")).toBeVisible();
    expect((await readJson(path.join(ws.workspacePath, "harmony.json"))).techStack?.backend?.framework).not.toBe("gin"); // まだ保存していない
    await page.getByRole("button", { name: /保存/ }).first().click();
    await expect.poll(async () => (await readJson(path.join(ws.workspacePath, "harmony.json"))).techStack?.backend?.framework).toBe("gin");
    expect((await readJson(path.join(ws.workspacePath, "harmony.json"))).techStack).toMatchObject({ backend: { language: "go", framework: "gin" }, database: { type: "postgresql" }, deployment: { target: "kubernetes" } });
  });

  test("版と更新: 版・コミット・リリースノートが出る。前回見た版と違えば、更新の案内が出る (初回は出ない)", async ({ page }) => {
    await ws.gotoActive(page, "/operations");
    await page.getByTestId("op-tab-version").click();
    await expect(page.getByTestId("op-version-info")).toContainText("版", { timeout: 15000 });
    await expect(page.getByTestId("op-version-info")).toContainText(/\d+\.\d+\.\d+/);
    await expect(page.getByTestId("op-release-notes")).toContainText("改善提案 第 4 弾");
    // 見た版を、別の値にして開き直す → 更新の案内
    await page.evaluate(() => localStorage.setItem("harmony.seenVersion", "0.0.1+old"));
    await ws.gotoActive(page, "/");
    await expect(page.locator("body")).toContainText("Harmony が更新されました", { timeout: 20000 });
    // もう一度開いても、案内は出ない (見た版を更新済み)
    expect(await page.evaluate(() => localStorage.getItem("harmony.seenVersion"))).not.toBe("0.0.1+old");
  });
});
